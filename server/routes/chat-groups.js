import { Router } from 'express';
import { asyncHandler, createHttpError } from '../lib/http.js';
import {
    buildChatGroups,
    canManageChatGroups,
    getChatGroupChangeError
} from '../lib/chat-groups.js';
import { getRecord, listRecords, upsertRecord } from '../lib/records.js';
import { hasPermission } from '../lib/permissions.js';
import { listOnlineUserIds, requireAuthenticatedUser } from '../lib/sessions.js';
import { nowIso } from '../lib/time.js';
import { normalizeEmail } from '../lib/text.js';

const router = Router();

const loadChatGroupContext = async () => {
    const [clients, messages, membershipRecords, users, managers, editors, teamGroups] = await Promise.all([
        listRecords({ collectionName: 'clients' }),
        listRecords({ collectionName: 'client_chats' }),
        listRecords({ collectionName: 'chat_group_memberships' }),
        listRecords({ collectionName: 'users' }),
        listRecords({ collectionName: 'managers' }),
        listRecords({ collectionName: 'editors' }),
        listRecords({ collectionName: 'team_groups' })
    ]);
    return {
        clients,
        messages,
        membershipRecords,
        users,
        managers,
        editors,
        teamGroups,
        ...buildChatGroups({ clients, messages, membershipRecords, users, managers, editors, teamGroups })
    };
};

const requireChatAccess = (userRecord) => {
    if (!hasPermission(userRecord, 'view_client_chat')) {
        throw createHttpError(403, 'No tienes permisos para el chat.', 'auth/insufficient-permission');
    }
};

router.get('/', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    requireChatAccess(userRecord);
    const [context, onlineUserIds] = await Promise.all([
        loadChatGroupContext(),
        listOnlineUserIds()
    ]);
    const currentUserId = context.resolvePersonId({
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name
    });
    const onlineIdSet = new Set(onlineUserIds.map(String));
    if (userRecord.id) onlineIdSet.add(String(userRecord.id));
    if (currentUserId) onlineIdSet.add(String(currentUserId));

    const onlineByEmail = new Set(
        context.people
            .filter((person) => onlineIdSet.has(String(person.id)))
            .map((person) => normalizeEmail(person.email))
            .filter(Boolean)
    );

    const people = context.people.map((person) => {
        const online = onlineIdSet.has(String(person.id))
            || onlineByEmail.has(normalizeEmail(person.email));
        return { ...person, online };
    });
    const onlinePersonIds = people
        .filter((person) => person.online)
        .map((person) => String(person.id));

    res.json({
        people,
        groups: context.groups,
        currentUserId,
        onlineUserIds: onlinePersonIds,
        canManage: canManageChatGroups(userRecord),
        canLeave: userRecord.role === 'super_admin'
    });
}));

router.put('/:clientId/members', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    requireChatAccess(userRecord);
    const clientId = String(req.params.clientId || '').trim();
    if (!clientId || !(await getRecord({ collectionName: 'clients', recordId: clientId }))) {
        throw createHttpError(404, 'El grupo no existe.', 'chat-groups/not-found');
    }

    const context = await loadChatGroupContext();
    const group = context.groups.find((item) => item.clientId === clientId);
    if (!Array.isArray(req.body?.memberIds)) {
        throw createHttpError(400, 'La lista de integrantes no es valida.', 'chat-groups/invalid-members');
    }
    const requestedIds = [...new Set(
        req.body.memberIds
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )];
    const knownIds = new Set(context.people.map((person) => String(person.id)));
    const unknownIds = requestedIds.filter((id) => !knownIds.has(id));
    if (unknownIds.length > 0) {
        throw createHttpError(400, 'Hay integrantes que ya no pertenecen al directorio.', 'chat-groups/unknown-member');
    }

    const actorId = context.resolvePersonId({
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name
    });
    const changeError = getChatGroupChangeError({
        actorRole: userRecord.role,
        actorId,
        currentMemberIds: group?.memberIds || [],
        nextMemberIds: requestedIds
    });
    if (changeError === 'membership-required') {
        throw createHttpError(403, 'No perteneces a este grupo.', 'chat-groups/membership-required');
    }
    if (changeError === 'remove-forbidden') {
        throw createHttpError(403, 'Solo managers y superadmins pueden quitar integrantes.', 'chat-groups/remove-forbidden');
    }
    if (changeError === 'manager-cannot-leave') {
        throw createHttpError(403, 'Los managers no pueden salir por si mismos del grupo.', 'chat-groups/manager-cannot-leave');
    }

    const stamp = nowIso();
    const record = await upsertRecord({
        collectionName: 'chat_group_memberships',
        recordId: clientId,
        payload: {
            clientId,
            memberIds: requestedIds,
            managed: true,
            updatedAt: stamp,
            updatedById: actorId || userRecord.id,
            updatedByName: userRecord.name || userRecord.email || 'Usuario'
        },
        merge: true
    });

    res.json({
        group: {
            clientId,
            memberIds: record.memberIds || [],
            source: 'managed',
            updatedAt: record.updatedAt || stamp
        }
    });
}));

export default router;
