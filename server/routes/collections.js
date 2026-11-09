import express from 'express';
import { db } from '../db/knex.js';
import { asyncHandler, createHttpError } from '../lib/http.js';
import { assertTaskPrivilegedFields, getCollectionPermission, hasPermission, normalizePermissionPacks } from '../lib/permissions.js';
import {
    createRecord,
    deleteRecord,
    findFirstRecordByAuthUid,
    findFirstRecordByEmail,
    getRecord,
    getLatestRecordChangeId,
    listRecordChanges,
    listRecords,
    upsertRecord
} from '../lib/records.js';
import { DEFAULT_TASK_DUE_TIME, prepareManagementTaskPayload } from '../lib/management-tasks.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';
import { normalizeEmail } from '../lib/text.js';
import { sendClientChatPush } from '../lib/push-notifications.js';
import {
    buildChatGroups,
    canManageChatGroups,
    isDmParticipant,
    parseDmClientId
} from '../lib/chat-groups.js';
import { nowIso } from '../lib/time.js';
import { writeAuditLog } from '../lib/audit.js';
import { recordTaskActivity } from '../lib/task-activity.js';
import { MAX_ATTACHMENT_COUNT, sanitizeAttachments } from '../lib/attachments.js';
import { normalizeClientPriority } from '../lib/client-priority.js';
import { normalizeTaskAssignees } from '../lib/task-assignees.js';

const router = express.Router();

const getCollectionName = (req) => String(req.params.collectionName || '').trim();

// Estas colecciones forman parte del estado base de la app para todos los roles,
// pero nunca deben exponerse sin una sesion activa.
const AUTHENTICATED_READ_COLLECTIONS = new Set([
    // `users` es lectura autenticada pero acotada: sin view_users cada quien
    // solo recibe su propio registro. El cliente lo necesita para conocer su
    // rol real; devolver 403 lo dejaba sin perfil y lo degradaba a viewer.
    'users'
]);

const OWNED_CHAT_COLLECTIONS = new Set([
    'chat_reads',
    'chat_mutes',
    'chat_hidden',
    'chat_reactions'
]);
const PRIVATE_CHAT_COLLECTIONS = new Set([
    'chat_reads',
    'chat_mutes',
    'chat_hidden'
]);
const CHAT_CONTEXT_COLLECTIONS = new Set([
    ...OWNED_CHAT_COLLECTIONS,
    'chat_pins'
]);
const TASK_COLLECTIONS = new Set(['account_tasks', 'editing', 'management_tasks']);
const KANBAN_STATUSES = {
    account_tasks: new Set(['por_disenar', 'aprobacion_interna', 'aprobado_internamente', 'publicado']),
    editing: new Set(['editar', 'correccion', 'en_edicion', 'revision_interna', 'aprobado', 'publicado']),
    management_tasks: new Set(['pendiente', 'en_proceso', 'en_espera', 'cerrado'])
};
const KANBAN_STATUS_PATCH_FIELDS = new Set([
    'lastStatusChangedAt', 'statusTimestamps', 'completedAt', 'completedByUserId',
    'ownerAtCompletionId', 'assigneeUserAtCompletionId', 'assigneesAtCompletion',
    'dueDateAtCompletion', 'publishedAt', 'approvedAt', 'internallyApprovedAt',
    'closedAt', 'editorCompletedAt', 'editorCompletedByUserId',
    'editorOwnerAtCompletionId', 'editorAssigneeUserAtCompletionId',
    'editorAssigneesAtCompletion', 'editorDueDateAtCompletion',
    'editorReworkCount', 'lastEditorReworkAt'
]);
const BATCH_COLLECTIONS = new Set([
    'clients',
    'events',
    'managers',
    'editors',
    ...TASK_COLLECTIONS
]);
const VALID_USER_ROLES = new Set([
    'super_admin',
    'operations',
    'management',
    'manager',
    'editor',
    'viewer'
]);
const MAX_BATCH_OPERATIONS = 100;
const MAX_RECORD_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIMIT_BY_COLLECTION = {
    client_chats: 1_000,
    chat_stickers: 200,
    audit_logs: 120
};

const resolveListLimit = (collectionName, requested) => {
    const fallback = DEFAULT_LIMIT_BY_COLLECTION[collectionName] || 5_000;
    const parsed = Number(requested);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), fallback);
};

const getChangedFields = (existing = {}, updated = {}, incoming = {}) => (
    Object.keys(incoming).filter((field) => (
        field !== 'updatedAt'
        && JSON.stringify(existing[field]) !== JSON.stringify(updated[field])
    ))
);

const getKanbanStatus = (collectionName, task = {}) => (
    collectionName === 'editing' && task.status === 'correccion'
        ? 'en_edicion'
        : String(task.status || '')
);

const compareKanbanOrder = (left, right) => {
    const leftOrder = Number(left.boardOrder);
    const rightOrder = Number(right.boardOrder);
    const leftHasOrder = Number.isFinite(leftOrder);
    const rightHasOrder = Number.isFinite(rightOrder);
    if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;
    return String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
        || String(left.id).localeCompare(String(right.id));
};

const assertRecordId = (value) => {
    const recordId = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(recordId)) {
        throw createHttpError(400, 'El identificador del documento no es valido.', 'document/invalid-id');
    }
    return recordId;
};

const assertPayload = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw createHttpError(400, 'Los datos deben ser un objeto JSON.', 'document/invalid-data');
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_RECORD_BYTES) {
        throw createHttpError(413, 'El documento supera el limite de 5 MB.', 'document/too-large');
    }
    return value;
};

const isOwnedByActor = (record, actor) => (
    Boolean(record && actor?.id)
    && String(record.userId || '') === String(actor.id)
);

const ensureOwnedChatRecord = (collectionName, existing, actor) => {
    if (OWNED_CHAT_COLLECTIONS.has(collectionName) && existing && !isOwnedByActor(existing, actor)) {
        throw createHttpError(403, 'No puedes modificar datos privados de otro usuario.', 'auth/resource-owner-required');
    }
};

const validateUserMutation = async ({ existing = null, payload, recordId = '' }) => {
    const emailMatch = await findFirstRecordByEmail({
        collectionName: 'users',
        email: payload.email
    });
    if (emailMatch && emailMatch.id !== (existing?.id || recordId)) {
        throw createHttpError(409, 'Ya existe un usuario con ese correo.', 'user/email-conflict');
    }
    if (payload.authUid) {
        const authUidMatch = await findFirstRecordByAuthUid({
            collectionName: 'users',
            authUid: payload.authUid
        });
        if (authUidMatch && authUidMatch.id !== (existing?.id || recordId)) {
            throw createHttpError(409, 'La identidad de acceso ya pertenece a otro usuario.', 'user/auth-uid-conflict');
        }
    }

    const removesActiveAdmin = existing?.role === 'super_admin'
        && existing?.isActive !== false
        && (payload.role !== 'super_admin' || payload.isActive === false);
    if (!removesActiveAdmin) return;

    const users = await listRecords({ collectionName: 'users' });
    const hasAnotherAdmin = users.some((user) => (
        user.id !== existing.id
        && user.role === 'super_admin'
        && user.isActive !== false
    ));
    if (!hasAnotherAdmin) {
        throw createHttpError(409, 'No puedes desactivar al ultimo super administrador.', 'user/last-admin');
    }
};

// El responsable de una tarea puede vivir en cualquiera de los tres
// directorios: el selector de la UI mezcla managers/editors con el resto de
// usuarios de la app, asi que exigir una sola coleccion dejaba sin poder
// agendar a quien no estuviera en el directorio de esa sala.
const PEOPLE_COLLECTIONS = ['users', 'managers', 'editors'];

const validateReferences = async ({ collectionName, existing = null, payload, trx }) => {
    const record = { ...(existing || {}), ...(payload || {}) };
    // Solo se valida lo que esta escritura cambia. Una referencia heredada y ya
    // rota (datos viejos) no puede bloquear editar la tarea ni moverla de
    // columna; al crear no hay `existing` y se valida todo.
    const requireReference = async (field, collections) => {
        if (existing && String(record[field] ?? '') === String(existing[field] ?? '')) return;
        const recordId = String(record[field] || '');
        if (!recordId) return;
        await requireReferenceValue(recordId, collections);
    };

    const requireReferenceValue = async (recordId, collections) => {
        const id = String(recordId || '').trim();
        if (!id) return;
        for (const name of collections) {
            if (await getRecord({ collectionName: name, recordId: id, trx })) return;
        }
        throw createHttpError(400, `La referencia ${id} no existe.`, 'document/invalid-reference');
    };

    if (TASK_COLLECTIONS.has(collectionName)) {
        await requireReference('clientId', ['clients']);
        await requireReference('contextId', PEOPLE_COLLECTIONS);
        await requireReference('assigneeUserId', PEOPLE_COLLECTIONS);
        const existingAssigneeIds = new Set([
            ...(Array.isArray(existing?.assignees) ? existing.assignees : []),
            existing?.contextId,
            existing?.assigneeUserId
        ].map((value) => String(value || '')).filter(Boolean));
        for (const assigneeId of (Array.isArray(record.assignees) ? record.assignees : [])) {
            if (existing && existingAssigneeIds.has(String(assigneeId))) continue;
            await requireReferenceValue(assigneeId, PEOPLE_COLLECTIONS);
        }
    }
    if (collectionName === 'clients') {
        await requireReference('managerId', ['managers']);
    }
    if (collectionName === 'client_chats' && (record.kind === 'team_group' || existing?.kind === 'team_group')) {
        await requireReference('clientId', ['team_groups']);
    }
    if (collectionName === 'client_chats' && (record.kind === 'dm' || existing?.kind === 'dm')) {
        if (!parseDmClientId(record.clientId || existing?.clientId)) {
            throw createHttpError(400, 'El chat directo no es valido.', 'chat/invalid-dm');
        }
    }
    if (collectionName === 'team_groups') {
        for (const memberId of (Array.isArray(record.memberIds) ? record.memberIds : [])) {
            await requireReferenceValue(memberId, PEOPLE_COLLECTIONS);
        }
    }
    if (collectionName === 'managers' || collectionName === 'editors') {
        await requireReference('userId', ['users']);
    }
    if (collectionName === 'users') {
        await requireReference('linkedManagerId', ['managers']);
        await requireReference('linkedEditorId', ['editors']);
    }
    if (['chat_hidden', 'chat_reactions', 'chat_pins'].includes(collectionName)) {
        const message = record.messageId
            ? await getRecord({ collectionName: 'client_chats', recordId: String(record.messageId), trx })
            : null;
        if (!message || String(message.clientId || '') !== String(record.clientId || '')) {
            throw createHttpError(400, 'El mensaje no pertenece al chat indicado.', 'chat/invalid-message-reference');
        }
    }
};

const assertRecordIsNotReferenced = async ({ collectionName, recordId, trx }) => {
    const checks = {
        users: [
            ['managers', (item) => item.userId === recordId],
            ['editors', (item) => item.userId === recordId],
            ['clients', (item) => item.managerUserId === recordId],
            ['account_tasks', (item) => item.assigneeUserId === recordId],
            ['editing', (item) => item.assigneeUserId === recordId],
            ['management_tasks', (item) => (
                item.assigneeUserId === recordId || item.contextId === recordId
            )]
        ],
        managers: [
            ['clients', (item) => item.managerId === recordId],
            ['account_tasks', (item) => item.contextId === recordId],
            ['users', (item) => item.linkedManagerId === recordId]
        ],
        editors: [
            ['editing', (item) => item.contextId === recordId],
            ['users', (item) => item.linkedEditorId === recordId]
        ],
        clients: [
            ['account_tasks', (item) => item.clientId === recordId],
            ['editing', (item) => item.clientId === recordId],
            ['management_tasks', (item) => item.clientId === recordId],
            ['client_chats', (item) => item.clientId === recordId]
        ]
    };
    for (const [sourceCollection, matches] of checks[collectionName] || []) {
        const records = await listRecords({ collectionName: sourceCollection, trx });
        if (records.some(matches)) {
            throw createHttpError(
                409,
                `No se puede eliminar: el registro esta referenciado por ${sourceCollection}.`,
                'document/in-use'
            );
        }
    }
};

const isInactiveUserRecord = (record = {}) => record?.isActive === false;
const isInactiveClientRecord = (record = {}) => String(record?.status || 'Activo') === 'Inactivo';

const assertRecordCanBeDeleted = async ({ collectionName, record, recordId, actor, trx }) => {
    if (collectionName === 'users') {
        if (String(recordId) === String(actor?.id || '')) {
            throw createHttpError(409, 'No puedes eliminar tu propio usuario.', 'document/cannot-delete-self');
        }
        if (!isInactiveUserRecord(record)) {
            throw createHttpError(409, 'Desactiva el usuario antes de eliminarlo.', 'document/must-deactivate');
        }
        return;
    }
    if (collectionName === 'clients') {
        if (!isInactiveClientRecord(record)) {
            throw createHttpError(409, 'Marca el cliente como inactivo antes de eliminarlo.', 'document/must-deactivate');
        }
        return;
    }
    await assertRecordIsNotReferenced({ collectionName, recordId, trx });
};

const ensureCollectionPermission = (req, action) => {
    const userRecord = requireAuthenticatedUser(req);
    const collectionName = getCollectionName(req);
    if (collectionName === 'audit_logs' && action !== 'read') {
        throw createHttpError(403, 'La auditoria es inmutable.', 'audit/immutable');
    }
    const permission = getCollectionPermission(collectionName, action);
    if (!permission) {
        throw createHttpError(404, 'La coleccion no existe.', 'collection/not-found');
    }
    if (!hasPermission(userRecord, permission)) {
        throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/insufficient-permission');
    }
    return { userRecord, collectionName };
};

// Campos que un usuario puede editar de su propio perfil (sin ser admin).
const PROFILE_SELF_FIELDS = new Set([
    'name',
    'profession',
    'photo',
    'themePalette',
    'themeMode',
    'updatedAt'
]);

// Sin view_users la coleccion `users` se recorta al propio registro.
const mustScopeUsersToSelf = (userRecord) => !hasPermission(userRecord, 'view_users');

const canUpdateOwnUser = (userRecord, existing = null) => {
    if (!existing) return false;
    const userId = String(userRecord?.id || '');
    if (userId && String(existing.id || '') === userId) return true;
    const userEmail = normalizeEmail(userRecord?.email);
    return Boolean(userEmail && existing.email && normalizeEmail(existing.email) === userEmail);
};

const pickSelfProfileFields = (payload = {}) => {
    const next = {};
    for (const key of Object.keys(payload || {})) {
        if (PROFILE_SELF_FIELDS.has(key)) next[key] = payload[key];
    }
    return next;
};

const canUpdateOwnManagementTask = (userRecord, existing = null) => {
    if (!existing || !hasPermission(userRecord, 'create_management_tasks')) return false;
    const userId = String(userRecord?.id || '');
    const userEmail = normalizeEmail(userRecord?.email);
    if (!userId) return false;
    if ([existing.assignedByUserId, existing.assigneeUserId, existing.contextId]
        .filter(Boolean)
        .some((value) => String(value) === userId)) {
        return true;
    }
    return Boolean(userEmail && normalizeEmail(existing.assignedByEmail) === userEmail);
};

// El autor de un mensaje de chat puede editar/borrar el suyo aunque no tenga
// el permiso de moderacion.
const canUpdateOwnChatMessage = (userRecord, existing = null) => {
    if (!existing || !hasPermission(userRecord, 'send_client_chat')) return false;
    const userId = String(userRecord?.id || '');
    if (userId && String(existing.authorId || '') === userId) return true;
    const userEmail = normalizeEmail(userRecord?.email);
    return Boolean(userEmail && existing.authorEmail && normalizeEmail(existing.authorEmail) === userEmail);
};

const ensureCollectionUpdatePermission = async (req, recordId) => {
    const userRecord = requireAuthenticatedUser(req);
    const collectionName = getCollectionName(req);
    if (collectionName === 'audit_logs') {
        throw createHttpError(403, 'La auditoria es inmutable.', 'audit/immutable');
    }
    const permission = getCollectionPermission(collectionName, 'update');
    if (!permission) {
        throw createHttpError(404, 'La coleccion no existe.', 'collection/not-found');
    }

    const existing = await getRecord({ collectionName, recordId });
    if (!existing) {
        // setDoc con id específico = upsert (semántica de Firestore): si el
        // documento no existe, permitir crearlo cuando se tiene permiso de
        // creación (p. ej. chat_reads / chat_hidden por usuario).
        const createPermission = getCollectionPermission(collectionName, 'create');
        if (createPermission && hasPermission(userRecord, createPermission)) {
            return { userRecord, collectionName, existing: null, selfEdit: false };
        }
        throw createHttpError(404, 'El documento no existe.', 'document/not-found');
    }

    if (hasPermission(userRecord, permission)
        || (collectionName === 'management_tasks' && canUpdateOwnManagementTask(userRecord, existing))
        || (collectionName === 'client_chats' && canUpdateOwnChatMessage(userRecord, existing))) {
        return { userRecord, collectionName, existing, selfEdit: false };
    }

    // Cualquier usuario activo puede editar su propio perfil (campos limitados).
    if (collectionName === 'users' && canUpdateOwnUser(userRecord, existing)) {
        return { userRecord, collectionName, existing, selfEdit: true };
    }

    throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/insufficient-permission');
};

const ensureCollectionReadPermission = (req) => {
    const collectionName = getCollectionName(req);
    const permission = getCollectionPermission(collectionName, 'read');
    if (!permission) {
        throw createHttpError(404, 'La coleccion no existe.', 'collection/not-found');
    }
    if (AUTHENTICATED_READ_COLLECTIONS.has(collectionName)) {
        return { userRecord: requireAuthenticatedUser(req), collectionName };
    }
    return ensureCollectionPermission(req, 'read');
};

const loadChatGroupAccess = async (
    userRecord,
    messages = null,
    allowOversight = true,
    includeContext = false
) => {
    const canAccessAll = allowOversight && canManageChatGroups(userRecord);
    if (canAccessAll && !includeContext) {
        return { canAccessAll: true, clientIds: new Set(), context: null };
    }
    const [clients, allMessages, membershipRecords, users, managers, editors, teamGroups] = await Promise.all([
        listRecords({ collectionName: 'clients' }),
        messages ? Promise.resolve(messages) : listRecords({ collectionName: 'client_chats' }),
        listRecords({ collectionName: 'chat_group_memberships' }),
        listRecords({ collectionName: 'users' }),
        listRecords({ collectionName: 'managers' }),
        listRecords({ collectionName: 'editors' }),
        listRecords({ collectionName: 'team_groups' })
    ]);
    const context = buildChatGroups({
        clients,
        messages: allMessages,
        membershipRecords,
        users,
        managers,
        editors,
        teamGroups
    });
    const actorId = context.resolvePersonId({
        id: userRecord?.id,
        email: userRecord?.email,
        name: userRecord?.name
    });
    return {
        canAccessAll,
        clientIds: new Set(context.groups
            .filter((group) => group.memberIds.map(String).includes(String(actorId)))
            .map((group) => String(group.clientId))),
        context
    };
};

const normalizeMentionIds = (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 50) {
        throw createHttpError(400, 'La lista de menciones no es valida.', 'chat/invalid-mentions');
    }
    const ids = value.map((item) => String(item || '').trim()).filter(Boolean);
    if (ids.some((id) => !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(id))) {
        throw createHttpError(400, 'La lista de menciones no es valida.', 'chat/invalid-mentions');
    }
    return [...new Set(ids)];
};

const ensureChatMentionsAllowed = async ({ userRecord, clientId, mentionedIds, isCall = false }) => {
    const ids = normalizeMentionIds(mentionedIds);
    if (ids.length === 0) return ids;

    const { context } = await loadChatGroupAccess(userRecord, null, true, true);
    const group = context?.groups?.find((item) => String(item.clientId) === String(clientId));
    const allowedIds = new Set((group?.memberIds || []).map(String));
    const dmParts = parseDmClientId(clientId);
    if (dmParts) {
        dmParts.forEach((id) => {
            allowedIds.add(String(context?.resolvePersonId?.({ id }) || id));
            allowedIds.add(String(id));
        });
    }
    if (isCall) {
        context?.people
            ?.filter((person) => person.canReceiveCallsOutsideGroups === true)
            .forEach((person) => allowedIds.add(String(person.id)));
    }
    if (ids.some((id) => !allowedIds.has(id))) {
        throw createHttpError(
            403,
            'Solo puedes mencionar integrantes autorizados del grupo.',
            'chat/mention-not-allowed'
        );
    }
    return ids;
};

const ensureChatClientAccess = async (userRecord, clientId, { allowOversight = false } = {}) => {
    const access = await loadChatGroupAccess(userRecord, null, allowOversight, true);
    if (access.canAccessAll || access.clientIds.has(String(clientId || ''))) return;
    const actorCandidates = [
        access.context?.resolvePersonId?.({
            id: userRecord?.id,
            email: userRecord?.email,
            name: userRecord?.name
        }),
        userRecord?.id
    ];
    if (isDmParticipant(clientId, actorCandidates)) return;
    throw createHttpError(403, 'No perteneces a este grupo.', 'chat-groups/membership-required');
};

const ensureChatContextAccess = async (userRecord, collectionName, record = {}) => {
    if (!CHAT_CONTEXT_COLLECTIONS.has(collectionName)) return;
    const clientId = String(record?.clientId || '').trim();
    if (!clientId) {
        throw createHttpError(400, 'El cliente del chat es obligatorio.', 'chat/client-required');
    }
    await ensureChatClientAccess(userRecord, clientId, { allowOversight: true });
};

const isOwnedChange = (change, userRecord) => {
    if (change.record) return isOwnedByActor(change.record, userRecord);
    const recordId = String(change.recordId || '');
    const userId = String(userRecord?.id || '');
    return Boolean(userId && (recordId.startsWith(`${userId}__`) || recordId.endsWith(`__${userId}`)));
};

const prepareCollectionPayload = ({ collectionName, payload, existing = null, actor = null, isCreate = false, recordId = null }) => {
    let safePayload = assertPayload(payload || {});
    if (Object.hasOwn(safePayload, 'attachments')) {
        safePayload = {
            ...safePayload,
            attachments: sanitizeAttachments(safePayload.attachments, {
                collectionName,
                recordId: recordId || existing?.id || null,
                clientId: existing?.clientId || safePayload.clientId || null
            })
        };
    }
    const stamp = nowIso();
    if (collectionName === 'audit_logs') {
        throw createHttpError(403, 'La auditoria solo puede escribirla el servidor.', 'audit/server-only');
    }
    if (collectionName === 'management_tasks') {
        return prepareManagementTaskPayload({
            payload: {
                ...safePayload,
                createdAt: existing?.createdAt || safePayload.createdAt || stamp,
                updatedAt: stamp
            },
            existing,
            actor,
            isCreate
        });
    }
    if (TASK_COLLECTIONS.has(collectionName)) {
        const title = String(safePayload.title ?? existing?.title ?? '').trim();
        if (!title) {
            throw createHttpError(400, 'El titulo de la tarea es obligatorio.', 'task/title-required');
        }
        const assignerName = String(actor?.name || actor?.email || existing?.assignedByName || '').trim();
        const shouldStampAssigner = isCreate || !String(existing?.assignedByEmail || '').trim();
        return {
            ...safePayload,
            ...normalizeTaskAssignees(safePayload, existing),
            ...(isCreate && String(safePayload.date || '').trim() && !String(safePayload.time || '').trim()
                ? { time: DEFAULT_TASK_DUE_TIME }
                : {}),
            ...(shouldStampAssigner ? {
                assignedByUserId: actor?.id || existing?.assignedByUserId || '',
                assignedByName: assignerName || 'Sistema',
                assignedByEmail: normalizeEmail(actor?.email || existing?.assignedByEmail || '')
            } : {}),
            title,
            createdAt: existing?.createdAt || safePayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    if (collectionName === 'clients') {
        const name = String(safePayload.name ?? existing?.name ?? '').trim();
        if (!name) {
            throw createHttpError(400, 'El nombre del cliente es obligatorio.', 'client/name-required');
        }
        return {
            ...safePayload,
            name,
            priorityFlag: normalizeClientPriority(
                Object.hasOwn(safePayload, 'priorityFlag')
                    ? safePayload.priorityFlag
                    : (existing?.priorityFlag || existing?.priority)
            ),
            createdAt: existing?.createdAt || safePayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    if (collectionName === 'team_groups') {
        const name = String(safePayload.name ?? existing?.name ?? '').trim();
        const memberIds = [...new Set(
            (Array.isArray(safePayload.memberIds) ? safePayload.memberIds : (existing?.memberIds || []))
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        )];
        if (!name) {
            throw createHttpError(400, 'El nombre del grupo es obligatorio.', 'team-groups/name-required');
        }
        if (memberIds.length < 1) {
            throw createHttpError(400, 'El grupo debe tener al menos un integrante.', 'team-groups/members-required');
        }
        return {
            ...safePayload,
            name: name.slice(0, 80),
            memberIds,
            createdById: existing?.createdById || actor?.id || '',
            createdByName: existing?.createdByName || actor?.name || '',
            createdAt: existing?.createdAt || safePayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    if (collectionName === 'events') {
        const title = String(safePayload.title ?? existing?.title ?? '').trim();
        const date = String(safePayload.date ?? existing?.date ?? '').trim();
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw createHttpError(400, 'El evento requiere titulo y fecha valida.', 'event/invalid-data');
        }
        return {
            ...safePayload,
            title,
            date,
            createdAt: existing?.createdAt || safePayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    if (collectionName === 'client_chats') {
        const text = String(safePayload.text ?? existing?.text ?? '').trim();
        const attachments = Array.isArray(safePayload.attachments)
            ? safePayload.attachments
            : (Array.isArray(existing?.attachments) ? existing.attachments : []);
        const call = safePayload.call ?? existing?.call ?? null;
        const sticker = safePayload.sticker ?? existing?.sticker ?? null;
        const hasContent = Boolean(
            text
            || attachments.length > 0
            || call
            || sticker
        );
        if (!hasContent || attachments.length > MAX_ATTACHMENT_COUNT) {
            throw createHttpError(400, 'El mensaje esta vacio o tiene demasiados adjuntos.', 'chat/invalid-message');
        }
        if (call && !/^[A-Za-z0-9_-]{3,120}$/.test(String(call.roomId || ''))) {
            throw createHttpError(400, 'La sala de llamada no es valida.', 'chat/invalid-call-room');
        }
        const rawKind = String(safePayload.kind || existing?.kind || 'client');
        const kind = rawKind === 'team_group'
            ? 'team_group'
            : rawKind === 'dm'
                ? 'dm'
                : 'client';
        if (kind === 'dm' && !parseDmClientId(safePayload.clientId || existing?.clientId)) {
            throw createHttpError(400, 'El chat directo no es valido.', 'chat/invalid-dm');
        }
        const threadRootId = String(
            safePayload.threadRootId ?? existing?.threadRootId ?? ''
        ).trim().slice(0, 120);
        return {
            ...safePayload,
            kind,
            text: text.slice(0, 20_000),
            attachments,
            mentionedIds: normalizeMentionIds(safePayload.mentionedIds ?? existing?.mentionedIds),
            call,
            sticker,
            threadRootId: threadRootId || null,
            replyTo: safePayload.replyTo ?? existing?.replyTo ?? null,
            authorId: String(existing?.authorId || actor?.id || ''),
            authorEmail: normalizeEmail(existing?.authorEmail || actor?.email),
            authorName: existing?.authorName || actor?.name || '',
            createdAt: existing?.createdAt || safePayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    if (OWNED_CHAT_COLLECTIONS.has(collectionName)) {
        return {
            ...safePayload,
            userId: String(actor?.id || ''),
            updatedAt: stamp
        };
    }
    if (collectionName === 'chat_pins') {
        return {
            ...safePayload,
            pinnedByUserId: String(actor?.id || ''),
            pinnedByName: actor?.name || '',
            pinnedAt: existing?.pinnedAt || safePayload.pinnedAt || stamp
        };
    }
    if (collectionName === 'chat_stickers') {
        const data = String(safePayload.data ?? existing?.data ?? '');
        const type = String(safePayload.type ?? existing?.type ?? '');
        if (
            !['image/webp', 'image/gif', 'image/png', 'image/jpeg'].includes(type)
            || !data.startsWith('data:image/')
            || Buffer.byteLength(data, 'utf8') > 768 * 1024
        ) {
            throw createHttpError(400, 'El sticker debe ser una imagen valida menor de 768 KB.', 'chat/invalid-sticker');
        }
        return {
            ...safePayload,
            data,
            type,
            name: String(safePayload.name || 'sticker').trim().slice(0, 120),
            authorId: String(existing?.authorId || actor?.id || ''),
            authorEmail: normalizeEmail(existing?.authorEmail || actor?.email),
            authorName: existing?.authorName || actor?.name || '',
            createdAt: existing?.createdAt || safePayload.createdAt || stamp
        };
    }
    if (collectionName === 'users') {
        const nextPayload = safePayload;
        const role = String(nextPayload.role || existing?.role || 'viewer');
        if (!VALID_USER_ROLES.has(role)) {
            throw createHttpError(400, 'El rol del usuario no es valido.', 'user/invalid-role');
        }
        const targetEmail = normalizeEmail(nextPayload.email || existing?.email);
        if (!targetEmail) {
            throw createHttpError(400, 'El correo del usuario es obligatorio.', 'user/email-required');
        }
        return {
            ...nextPayload,
            email: targetEmail,
            role,
            isActive: nextPayload.isActive !== false,
            ...(Object.hasOwn(nextPayload, 'permissionPacks')
                ? { permissionPacks: normalizePermissionPacks(nextPayload.permissionPacks) }
                : {}),
            createdAt: existing?.createdAt || nextPayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    if (collectionName === 'managers' || collectionName === 'editors') {
        const name = String(safePayload.name ?? existing?.name ?? '').trim();
        const email = normalizeEmail(safePayload.email ?? existing?.email);
        if (!name) {
            throw createHttpError(400, 'El nombre es obligatorio.', 'directory/name-required');
        }
        return {
            ...safePayload,
            name: name.slice(0, 160),
            email,
            createdAt: existing?.createdAt || safePayload.createdAt || stamp,
            updatedAt: stamp
        };
    }
    return safePayload;
};

router.post('/_batch', asyncHandler(async (req, res) => {
    const operations = Array.isArray(req.body?.ops) ? req.body.ops : [];
    if (operations.length === 0) {
        res.json({ ok: true, operations: 0 });
        return;
    }
    if (operations.length > MAX_BATCH_OPERATIONS) {
        throw createHttpError(413, 'El lote supera el limite de 100 operaciones.', 'batch/too-large');
    }

    const actor = requireAuthenticatedUser(req);

    await db.transaction(async (trx) => {
        for (const operation of operations) {
            const collectionName = String(operation?.collectionName || '').trim();
            const action = String(operation?.action || '').trim();
            if (!BATCH_COLLECTIONS.has(collectionName)) {
                throw createHttpError(
                    403,
                    'Esta coleccion no admite escrituras en lote.',
                    'batch/collection-denied'
                );
            }
            if (!['create', 'set', 'update', 'delete'].includes(action)) {
                throw createHttpError(400, `Operacion de lote no soportada: ${action}`, 'batch/unsupported-action');
            }

            const recordId = assertRecordId(operation.recordId);
            const existing = await getRecord({ collectionName, recordId, trx });
            const permissionAction = action === 'create' || (action === 'set' && !existing)
                ? 'create'
                : action === 'delete'
                    ? 'delete'
                    : 'update';
            const permission = getCollectionPermission(collectionName, permissionAction);
            if (!permission || !hasPermission(actor, permission)) {
                throw createHttpError(403, 'No tienes permisos para ejecutar el lote.', 'auth/insufficient-permission');
            }

            if (action === 'delete') {
                if (!existing) {
                    throw createHttpError(404, 'El documento no existe.', 'document/not-found');
                }
                await assertRecordCanBeDeleted({
                    collectionName,
                    record: existing,
                    recordId,
                    actor,
                    trx
                });
                await deleteRecord({
                    collectionName,
                    recordId,
                    trx
                });
                await writeAuditLog({ actor, action: 'delete', collectionName, recordId, trx });
                await recordTaskActivity({ actor, collectionName, task: existing, action: 'deleted', trx });
                continue;
            }

            if (action === 'update' && !existing) {
                throw createHttpError(404, 'El documento no existe.', 'document/not-found');
            }

            const incoming = assertPayload(operation.data || {});
            const payload = prepareCollectionPayload({
                collectionName,
                payload: incoming,
                existing,
                actor,
                isCreate: !existing,
                recordId
            });
            assertTaskPrivilegedFields({
                collectionName,
                existing,
                incoming,
                actor,
                isCreate: !existing
            });
            await validateReferences({ collectionName, existing, payload, trx });

            if (action === 'create' || (action === 'set' && !existing)) {
                const created = await createRecord({
                    collectionName,
                    recordId,
                    payload,
                    trx
                });
                await writeAuditLog({ actor, action: 'create', collectionName, recordId, trx });
                await recordTaskActivity({ actor, collectionName, task: created, action: 'created', trx });
                continue;
            }

            const updated = await upsertRecord({
                collectionName,
                recordId,
                payload,
                merge: action === 'update' || operation.merge !== false,
                trx
            });
            await writeAuditLog({ actor, action: 'update', collectionName, recordId, trx });
            await recordTaskActivity({
                actor,
                collectionName,
                task: updated,
                action: 'updated',
                fields: getChangedFields(existing, updated, incoming),
                trx
            });
        }
    });

    res.json({ ok: true, operations: operations.length });
}));

router.post('/_kanban/move', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    const collectionName = String(req.body?.collectionName || '').trim();
    const taskId = assertRecordId(req.body?.taskId);
    const targetStatus = String(req.body?.targetStatus || '').trim();
    const beforeId = req.body?.beforeId ? assertRecordId(req.body.beforeId) : '';
    const statusPatch = req.body?.statusPatch && typeof req.body.statusPatch === 'object'
        && !Array.isArray(req.body.statusPatch) ? req.body.statusPatch : {};
    if (!TASK_COLLECTIONS.has(collectionName) || !KANBAN_STATUSES[collectionName]?.has(targetStatus)) {
        throw createHttpError(400, 'La columna de destino no es válida.', 'kanban/invalid-column');
    }
    if (Object.keys(statusPatch).some((field) => !KANBAN_STATUS_PATCH_FIELDS.has(field))) {
        throw createHttpError(400, 'Los datos del cambio de estado no son válidos.', 'kanban/invalid-status-data');
    }
    if (statusPatch.status && statusPatch.status !== targetStatus) {
        throw createHttpError(400, 'El estado no coincide con la columna de destino.', 'kanban/status-mismatch');
    }
    const permission = getCollectionPermission(collectionName, 'update');
    if (!permission || !hasPermission(actor, permission)) {
        throw createHttpError(403, 'No tienes permiso para mover esta tarea.', 'auth/insufficient-permission');
    }

    const result = await db.transaction(async (trx) => {
        const allTasks = await listRecords({ collectionName, trx });
        const movingTask = allTasks.find((item) => String(item.id) === taskId);
        if (!movingTask) throw createHttpError(404, 'La tarea no existe.', 'document/not-found');
        const sourceStatus = getKanbanStatus(collectionName, movingTask);
        if (!KANBAN_STATUSES[collectionName].has(sourceStatus)) {
            throw createHttpError(409, 'El estado actual de la tarea no pertenece al tablero.', 'kanban/invalid-source');
        }

        const orderedByStatus = (status) => allTasks
            .filter((item) => String(item.id) !== taskId && getKanbanStatus(collectionName, item) === status)
            .sort(compareKanbanOrder);
        const targetTasks = orderedByStatus(targetStatus);
        const insertIndex = beforeId
            ? targetTasks.findIndex((item) => String(item.id) === beforeId)
            : targetTasks.length;
        if (beforeId && insertIndex < 0) {
            throw createHttpError(409, 'La tarjeta de destino ya no está en esa columna.', 'kanban/stale-target');
        }
        targetTasks.splice(insertIndex, 0, movingTask);

        const sequences = new Map([[targetStatus, targetTasks]]);
        if (sourceStatus !== targetStatus) sequences.set(sourceStatus, orderedByStatus(sourceStatus));
        const stamp = nowIso();
        const updatedRecords = new Map();

        for (const [status, sequence] of sequences) {
            for (let index = 0; index < sequence.length; index += 1) {
                const item = sequence[index];
                const boardOrder = (index + 1) * 10;
                const isMovingTask = String(item.id) === taskId;
                const statusChanged = isMovingTask && sourceStatus !== targetStatus;
                if (!statusChanged && Number(item.boardOrder) === boardOrder) continue;

                const incoming = isMovingTask
                    ? { ...statusPatch, ...(statusChanged ? { status: targetStatus } : {}), boardOrder, updatedAt: stamp }
                    : { boardOrder, updatedAt: stamp };
                const payload = isMovingTask
                    ? prepareCollectionPayload({ collectionName, payload: incoming, existing: movingTask, actor, recordId: taskId })
                    : { ...item, ...incoming, id: item.id };
                if (isMovingTask) {
                    assertTaskPrivilegedFields({ collectionName, existing: movingTask, incoming, actor });
                }
                const updated = await upsertRecord({ collectionName, recordId: item.id, payload, trx });
                updatedRecords.set(String(item.id), updated);
            }
        }

        const movedRecord = updatedRecords.get(taskId) || movingTask;
        if (sourceStatus !== targetStatus) {
            await writeAuditLog({ actor, action: 'status_change', collectionName, recordId: taskId, trx });
            await recordTaskActivity({
                actor,
                collectionName,
                task: movedRecord,
                action: 'updated',
                fields: ['status'],
                trx
            });
        }
        return { records: [...updatedRecords.values()], task: movedRecord };
    });

    res.json(result);
}));

router.get('/_sync', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    const requestedCollections = String(req.query.collections || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const collections = requestedCollections.filter((collectionName) => {
        const permission = getCollectionPermission(collectionName, 'read');
        return permission && (AUTHENTICATED_READ_COLLECTIONS.has(collectionName) || hasPermission(userRecord, permission));
    });

    if (req.query.latest === '1') {
        res.json({ cursor: await getLatestRecordChangeId() });
        return;
    }

    if (collections.length === 0) {
        res.json({ cursor: Number(req.query.cursor) || 0, hasMore: false, changes: [] });
        return;
    }

    const result = await listRecordChanges({
        afterId: Number(req.query.cursor) || 0,
        collections,
        limitCount: 500
    });
    if (collections.includes('users') && mustScopeUsersToSelf(userRecord)) {
        result.changes = result.changes.filter((change) => (
            change.collectionName !== 'users'
            || !change.record
            || canUpdateOwnUser(userRecord, change.record)
        ));
    }
    if (collections.includes('client_chats') && !canManageChatGroups(userRecord)) {
        const access = await loadChatGroupAccess(userRecord);
        result.changes = result.changes.filter((change) => (
            change.collectionName !== 'client_chats'
            || !change.record
            || access.clientIds.has(String(change.record.clientId || ''))
        ));
    }
    for (const collectionName of PRIVATE_CHAT_COLLECTIONS) {
        if (!collections.includes(collectionName)) continue;
        result.changes = result.changes.filter((change) => (
            change.collectionName !== collectionName || isOwnedChange(change, userRecord)
        ));
    }
    const sharedChatCollections = ['chat_reactions', 'chat_pins']
        .filter((collectionName) => collections.includes(collectionName));
    if (sharedChatCollections.length > 0) {
        const access = await loadChatGroupAccess(userRecord);
        result.changes = result.changes.filter((change) => (
            !sharedChatCollections.includes(change.collectionName)
            || (
                change.record
                && (access.canAccessAll || access.clientIds.has(String(change.record.clientId || '')))
            )
        ));
    }
    res.json(result);
}));

router.get('/:collectionName', asyncHandler(async (req, res) => {
    const { collectionName, userRecord } = ensureCollectionReadPermission(req);
    const mustFilterChat = collectionName === 'client_chats' && !canManageChatGroups(userRecord);
    let records = await listRecords({
        collectionName,
        sortBy: String(req.query.orderBy || 'updatedAt'),
        sortDirection: String(req.query.orderDir || 'asc'),
        limitCount: mustFilterChat
            ? undefined
            : resolveListLimit(collectionName, req.query.limit),
        dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
        dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
        includeOpenBefore: req.query.includeOpenBefore === '1'
    });

    if (mustFilterChat) {
        const access = await loadChatGroupAccess(userRecord, records);
        records = records.filter((record) => access.clientIds.has(String(record.clientId || '')));
        records = records.slice(0, resolveListLimit(collectionName, req.query.limit));
    }

    if (collectionName === 'users' && mustScopeUsersToSelf(userRecord)) {
        records = records.filter((record) => canUpdateOwnUser(userRecord, record));
    }
    if (PRIVATE_CHAT_COLLECTIONS.has(collectionName)) {
        records = records.filter((record) => isOwnedByActor(record, userRecord));
    }
    if (CHAT_CONTEXT_COLLECTIONS.has(collectionName) && !PRIVATE_CHAT_COLLECTIONS.has(collectionName)) {
        const access = await loadChatGroupAccess(userRecord);
        records = records.filter((record) => (
            access.canAccessAll || access.clientIds.has(String(record.clientId || ''))
        ));
    }

    res.json({ records });
}));

router.get('/:collectionName/:recordId', asyncHandler(async (req, res) => {
    const { collectionName, userRecord } = ensureCollectionReadPermission(req);
    const record = await getRecord({ collectionName, recordId: req.params.recordId });
    if (!record) {
        throw createHttpError(404, 'El documento no existe.', 'document/not-found');
    }
    if (collectionName === 'client_chats') {
        await ensureChatClientAccess(userRecord, record.clientId, { allowOversight: true });
    }
    if (collectionName === 'users' && mustScopeUsersToSelf(userRecord) && !canUpdateOwnUser(userRecord, record)) {
        throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/insufficient-permission');
    }
    if (PRIVATE_CHAT_COLLECTIONS.has(collectionName) && !isOwnedByActor(record, userRecord)) {
        throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/resource-owner-required');
    }
    await ensureChatContextAccess(userRecord, collectionName, record);
    res.json({ record });
}));

router.post('/:collectionName', asyncHandler(async (req, res) => {
    const { collectionName, userRecord } = ensureCollectionPermission(req, 'create');
    const recordId = req.body?.id ? assertRecordId(req.body.id) : undefined;
    const rawPayload = assertPayload(req.body?.data || {});
    if (collectionName === 'client_chats') {
        await ensureChatClientAccess(userRecord, rawPayload.clientId);
        await ensureChatMentionsAllowed({
            userRecord,
            clientId: rawPayload.clientId,
            mentionedIds: rawPayload.mentionedIds,
            isCall: Boolean(rawPayload.call)
        });
    }
    ensureOwnedChatRecord(collectionName, null, userRecord);
    await ensureChatContextAccess(userRecord, collectionName, rawPayload);
    const payload = prepareCollectionPayload({
        collectionName,
        payload: rawPayload,
        actor: userRecord,
        isCreate: true,
        recordId
    });
    if (collectionName === 'users') {
        await validateUserMutation({ payload, recordId });
    }
    const record = await db.transaction(async (trx) => {
        await validateReferences({ collectionName, payload, trx });
        const created = await createRecord({
            collectionName,
            recordId,
            payload,
            trx
        });
        await writeAuditLog({
            actor: userRecord,
            action: 'create',
            collectionName,
            recordId: created.id,
            trx
        });
        await recordTaskActivity({ actor: userRecord, collectionName, task: created, action: 'created', trx });
        return created;
    });
    if (collectionName === 'client_chats') {
        const conversation = await getRecord({
            collectionName: 'clients',
            recordId: record.clientId
        }) || await getRecord({
            collectionName: 'team_groups',
            recordId: record.clientId
        });
        const dmLabel = record.kind === 'dm' ? 'Mensaje directo' : '';
        await sendClientChatPush({
            message: record,
            clientName: conversation?.name || dmLabel || 'Chat'
        }).catch((error) => console.warn('[push]', error?.message || error));
    }
    res.status(201).json({ record });
}));

router.put('/:collectionName/:recordId', asyncHandler(async (req, res) => {
    const recordId = assertRecordId(req.params.recordId);
    const { collectionName, userRecord, existing, selfEdit } = await ensureCollectionUpdatePermission(req, recordId);
    ensureOwnedChatRecord(collectionName, existing, userRecord);
    if (collectionName === 'client_chats') {
        await ensureChatClientAccess(userRecord, existing?.clientId || req.body?.data?.clientId);
    }
    const rawPayload = assertPayload(req.body?.data || {});
    if (collectionName === 'client_chats') {
        await ensureChatMentionsAllowed({
            userRecord,
            clientId: existing?.clientId || rawPayload.clientId,
            mentionedIds: rawPayload.mentionedIds ?? existing?.mentionedIds,
            isCall: Boolean(rawPayload.call ?? existing?.call)
        });
    }
    await ensureChatContextAccess(userRecord, collectionName, existing || rawPayload);
    const payload = prepareCollectionPayload({
        collectionName,
        payload: selfEdit ? pickSelfProfileFields(rawPayload) : rawPayload,
        existing,
        actor: userRecord,
        isCreate: !existing,
        recordId
    });
    assertTaskPrivilegedFields({
        collectionName,
        existing,
        incoming: rawPayload,
        actor: userRecord,
        isCreate: !existing
    });
    if (collectionName === 'users' && !selfEdit) {
        await validateUserMutation({ existing, payload, recordId });
    }
    const record = await db.transaction(async (trx) => {
        await validateReferences({ collectionName, existing, payload, trx });
        const updated = await upsertRecord({
            collectionName,
            recordId,
            payload,
            merge: selfEdit ? true : (req.body?.merge !== false),
            trx
        });
        await writeAuditLog({ actor: userRecord, action: 'update', collectionName, recordId, trx });
        await recordTaskActivity({
            actor: userRecord,
            collectionName,
            task: updated,
            action: 'updated',
            fields: getChangedFields(existing, updated, rawPayload),
            trx
        });
        return updated;
    });
    res.json({ record });
}));

router.patch('/:collectionName/:recordId', asyncHandler(async (req, res) => {
    const recordId = assertRecordId(req.params.recordId);
    const { collectionName, userRecord, existing, selfEdit } = await ensureCollectionUpdatePermission(req, recordId);
    ensureOwnedChatRecord(collectionName, existing, userRecord);
    if (collectionName === 'client_chats') {
        await ensureChatClientAccess(userRecord, existing?.clientId || req.body?.data?.clientId);
    }
    const rawPayload = assertPayload(req.body?.data || {});
    if (collectionName === 'client_chats') {
        await ensureChatMentionsAllowed({
            userRecord,
            clientId: existing?.clientId || rawPayload.clientId,
            mentionedIds: rawPayload.mentionedIds ?? existing?.mentionedIds,
            isCall: Boolean(rawPayload.call ?? existing?.call)
        });
    }
    await ensureChatContextAccess(userRecord, collectionName, existing || rawPayload);
    const payload = prepareCollectionPayload({
        collectionName,
        payload: selfEdit ? pickSelfProfileFields(rawPayload) : rawPayload,
        existing,
        actor: userRecord,
        isCreate: !existing,
        recordId
    });
    assertTaskPrivilegedFields({
        collectionName,
        existing,
        incoming: rawPayload,
        actor: userRecord,
        isCreate: !existing
    });
    if (collectionName === 'users' && !selfEdit) {
        await validateUserMutation({ existing, payload, recordId });
    }
    const record = await db.transaction(async (trx) => {
        await validateReferences({ collectionName, existing, payload, trx });
        const updated = await upsertRecord({
            collectionName,
            recordId,
            payload,
            merge: true,
            trx
        });
        await writeAuditLog({ actor: userRecord, action: 'update', collectionName, recordId, trx });
        await recordTaskActivity({
            actor: userRecord,
            collectionName,
            task: updated,
            action: 'updated',
            fields: getChangedFields(existing, updated, rawPayload),
            trx
        });
        return updated;
    });
    res.json({ record });
}));

router.delete('/:collectionName/:recordId', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    const collectionName = getCollectionName(req);
    const recordId = assertRecordId(req.params.recordId);
    if (collectionName === 'audit_logs') {
        throw createHttpError(403, 'La auditoria es inmutable.', 'audit/immutable');
    }
    const permission = getCollectionPermission(collectionName, 'delete');
    if (!permission) {
        throw createHttpError(404, 'La coleccion no existe.', 'collection/not-found');
    }
    if (!hasPermission(userRecord, permission)) {
        // El autor puede borrar su propio mensaje de chat o su propio sticker
        // subido sin ser moderador.
        const selfDeletable = collectionName === 'client_chats' || collectionName === 'chat_stickers';
        const existing = selfDeletable
            ? await getRecord({ collectionName, recordId })
            : null;
        if (!(selfDeletable && canUpdateOwnChatMessage(userRecord, existing))) {
            throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/insufficient-permission');
        }
    }
    const existing = await getRecord({ collectionName, recordId });
    if (!existing) {
        throw createHttpError(404, 'El documento no existe.', 'document/not-found');
    }
    ensureOwnedChatRecord(collectionName, existing, userRecord);
    if (collectionName === 'client_chats') {
        await ensureChatClientAccess(userRecord, existing.clientId);
    }
    await ensureChatContextAccess(userRecord, collectionName, existing);
    if (
        collectionName === 'users'
        && existing.role === 'super_admin'
        && existing.isActive !== false
    ) {
        await validateUserMutation({
            existing,
            recordId,
            payload: { ...existing, isActive: false }
        });
    }
    await db.transaction(async (trx) => {
        await assertRecordCanBeDeleted({
            collectionName,
            record: existing,
            recordId,
            actor: userRecord,
            trx
        });
        const deleted = await deleteRecord({
            collectionName,
            recordId,
            trx
        });
        if (!deleted) {
            throw createHttpError(404, 'El documento no existe.', 'document/not-found');
        }
        await writeAuditLog({ actor: userRecord, action: 'delete', collectionName, recordId, trx });
        await recordTaskActivity({ actor: userRecord, collectionName, task: existing, action: 'deleted', trx });
    });
    res.json({ ok: true });
}));

export default router;
