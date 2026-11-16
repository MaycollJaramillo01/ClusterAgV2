import { COLLECTION_PERMISSIONS, PERMISSION_PACKS, PERMISSION_PACK_IDS, ROLE_DEFINITIONS } from '../constants/permissions.js';
import { createHttpError } from './http.js';
import { normalizeEmail } from './text.js';

const TASK_PRIVILEGE_COLLECTIONS = new Set(['account_tasks', 'editing', 'management_tasks']);

export const getRoleMeta = (role = '') => ROLE_DEFINITIONS[role] || ROLE_DEFINITIONS.viewer;

export const normalizePermissionPacks = (value) => [...new Set(
    (Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter((id) => PERMISSION_PACK_IDS.has(id))
)];

export const getGrantedPermissions = (userRecord) => {
    const rolePermissions = getRoleMeta(userRecord?.role).permissions || [];
    if (rolePermissions.includes('*')) return ['*'];
    const granted = new Set(rolePermissions);
    for (const packId of normalizePermissionPacks(userRecord?.permissionPacks)) {
        const pack = PERMISSION_PACKS.find((item) => item.id === packId);
        for (const permission of pack?.grants || []) granted.add(permission);
    }
    return [...granted];
};

export const hasPermission = (userRecord, permission) => {
    if (!permission) return true;
    if (!userRecord || userRecord.isActive === false) return false;
    const permissions = getGrantedPermissions(userRecord);
    return permissions.includes('*') || permissions.includes(permission);
};

export const getCollectionPermission = (collectionName, action) => COLLECTION_PERMISSIONS[collectionName]?.[action] || null;

export const collectReportRecipientEmails = ({ users = [], extraEmails = [] } = {}) => {
    const emails = new Set();
    for (const value of extraEmails) {
        const email = normalizeEmail(value);
        if (email) emails.add(email);
    }
    for (const user of users) {
        if (!hasPermission(user, 'receive_reports')) continue;
        const email = normalizeEmail(user.email);
        if (email) emails.add(email);
    }
    return [...emails];
};

const asSortedIds = (value) => [...new Set(
    (Array.isArray(value) ? value : [value])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
)].sort();

const sameText = (left, right) => String(left || '') === String(right || '');

const existingAssigneeIds = (record = {}) => asSortedIds(
    Array.isArray(record.assignees) && record.assignees.length
        ? record.assignees
        : [record.contextId]
);

export const assertTaskPrivilegedFields = ({
    collectionName,
    existing = null,
    incoming = {},
    actor = null,
    isCreate = false
} = {}) => {
    if (!TASK_PRIVILEGE_COLLECTIONS.has(collectionName) || isCreate || !existing) return;

    const dateChanged = (
        (Object.hasOwn(incoming, 'date') && !sameText(incoming.date, existing.date))
        || (Object.hasOwn(incoming, 'time') && !sameText(incoming.time, existing.time))
    );
    if (dateChanged && !hasPermission(actor, 'edit_due_date')) {
        throw createHttpError(403, 'No tienes permiso para cambiar la fecha de entrega.', 'tasks/due-date-forbidden');
    }

    const assigneesChanged = (
        (Object.hasOwn(incoming, 'assignees') && asSortedIds(incoming.assignees).join('|') !== existingAssigneeIds(existing).join('|'))
        || (Object.hasOwn(incoming, 'contextId') && !sameText(incoming.contextId, existing.contextId))
        || (Object.hasOwn(incoming, 'assigneeUserId') && !sameText(incoming.assigneeUserId, existing.assigneeUserId || existing.contextId))
        || (Object.hasOwn(incoming, 'accountId') && !sameText(incoming.accountId, existing.accountId))
    );
    if (assigneesChanged && !hasPermission(actor, 'assign_tasks')) {
        throw createHttpError(403, 'No tienes permiso para cambiar las asignaciones.', 'tasks/assign-forbidden');
    }
};
