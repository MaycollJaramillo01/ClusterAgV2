import { getRolePriority, getSupervisorUsers } from '../../src/app/utils/compliance.js';
import { normalizeEmail } from './text.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const HONDURAS_OFFSET = '-06:00';
const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const computeDueAt = (task = {}, config = {}) => {
    const date = typeof task.date === 'string' ? task.date.trim() : '';
    const time = typeof task.time === 'string' && task.time.trim() ? task.time.trim() : (config.defaultTime || '');
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
    const iso = `${date}T${time}:00${HONDURAS_OFFSET}`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? { iso, ms } : null;
};

export const REMINDER_STAGES = [
    { key: 'reminder1hSentAt', hours: 1, label: '1 hora' }
];

const REMINDER_CLOSED = {
    account_tasks: new Set(['publicado', 'aprobado_internamente']),
    editing: new Set(['aprobado', 'publicado']),
    management_tasks: new Set(['cerrado']),
    events: new Set(['publicado', 'cerrado', 'aprobado'])
};

export const isReminderClosed = (collectionName, task = {}) => {
    const closed = REMINDER_CLOSED[collectionName];
    if (!closed) return false;
    const status = collectionName === 'events'
        ? String(task.status || '').toLowerCase()
        : task.status;
    return closed.has(status);
};

// En revisión el editor ya entregó. El aviso pasa al account que tiene que mirarla.
export const reminderLookupTask = (task = {}, collectionName = '') => {
    if (collectionName !== 'editing' || task.status !== 'revision_interna') return task;
    const accountId = String(task.accountId || '').trim();
    return {
        ...task,
        assignees: accountId ? [accountId] : [],
        contextId: accountId,
        assigneeUserId: ''
    };
};

export const reminderContextCollection = (collectionName = '', task = {}) => {
    if (collectionName === 'editing' && task.status === 'revision_interna') return 'managers';
    if (collectionName === 'account_tasks') return 'managers';
    if (collectionName === 'editing') return 'editors';
    return 'users';
};

const KNOWN_ROLES = new Set(['super_admin', 'operations', 'supervisor', 'management', 'manager', 'editor']);
// Si no se puede determinar el rol del responsable se conserva el comportamiento
// historico: avisan operations y super_admin (prioridad mayor a management).
const LEGACY_SUPERVISION_ROLE = 'management';
const HONDURAS_UTC_OFFSET_HOURS = -6;

/**
 * Los correos "continuos" solo salen dentro del horario laboral de Honduras
 * [startHour, endHour).
 */
export const isWithinNagWindow = (nowMs, { startHour = 7, endHour = 19 } = {}) => {
    if (!Number.isFinite(nowMs)) return false;
    const hour = new Date(nowMs + (HONDURAS_UTC_OFFSET_HOURS * HOUR_MS)).getUTCHours();
    return hour >= startHour && hour < endHour;
};

const resolveAssigneeRole = (assignee = {}, users = []) => {
    if (KNOWN_ROLES.has(assignee?.role)) return assignee.role;
    const email = normalizeEmail(assignee?.email);
    const user = email ? users.find((item) => normalizeEmail(item?.email) === email) : null;
    return KNOWN_ROLES.has(user?.role) ? user.role : '';
};

const highestRole = (roles = []) => roles
    .filter(Boolean)
    .reduce((best, role) => (!best || getRolePriority(role) > getRolePriority(best) ? role : best), '');

const clientManagerKeys = (task = {}, clients = []) => {
    const clientId = String(task?.clientId || '').trim();
    const client = clientId
        ? (Array.isArray(clients) ? clients : []).find((item) => String(item?.id) === clientId)
        : null;
    return new Set([client?.managerId, client?.managerUserId].filter(Boolean).map(String));
};

export const collectReminderRecipients = ({
    assignees = [],
    task = {},
    users = [],
    clients = []
} = {}) => {
    const byEmail = new Map();
    const add = (person, role) => {
        const email = normalizeEmail(person?.email);
        if (!email) return;
        const current = byEmail.get(email) || { email, name: '', roles: [] };
        const name = String(person?.name || '').trim();
        if (name && !current.name) current.name = name;
        if (!current.roles.includes(role)) current.roles.push(role);
        byEmail.set(email, current);
    };

    for (const assignee of assignees) add(assignee, 'assignee');
    add({
        email: task.assignedByEmail,
        name: task.assignedByName
    }, 'assigner');
    const assignerId = String(task.assignedByUserId || '').trim();
    if (assignerId) {
        const assignerUser = users.find((user) => String(user?.id) === assignerId);
        if (assignerUser) add(assignerUser, 'assigner');
    }

    const assigneeRole = highestRole(assignees.map((assignee) => resolveAssigneeRole(assignee, users)))
        || LEGACY_SUPERVISION_ROLE;
    const supervisors = getSupervisorUsers({
        role: assigneeRole,
        users,
        managerKeys: clientManagerKeys(task, clients)
    });
    for (const supervisor of supervisors) add(supervisor, 'supervisor');

    return [...byEmail.values()].map((item) => ({
        ...item,
        primaryRole: item.roles.includes('assignee')
            ? 'assignee'
            : item.roles.includes('assigner')
                ? 'assigner'
                : 'supervisor'
    }));
};

export const selectReminderAction = ({
    task = {},
    dueMs,
    nowMs,
    upcomingNagMs = DAY_MS,
    overdueNagMs = DAY_MS,
    nagAllowed = true
} = {}) => {
    if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) return null;
    const msUntilDue = dueMs - nowMs;
    if (msUntilDue > 0) {
        const hoursLeft = msUntilDue / HOUR_MS;
        const matching = REMINDER_STAGES.filter((stage) => hoursLeft <= stage.hours && !task[stage.key]);
        if (matching.length) {
            const stage = matching.reduce((left, right) => (left.hours <= right.hours ? left : right));
            return {
                type: 'upcoming',
                stage,
                label: stage.label,
                stampKeys: [...matching.map((item) => item.key), 'lastUpcomingNagAt']
            };
        }
        const firstSent = REMINDER_STAGES.map((stage) => task[stage.key]).find(Boolean);
        if (!firstSent || !nagAllowed) return null;
        const lastNag = Date.parse(task.lastUpcomingNagAt || firstSent);
        if (Number.isFinite(lastNag) && (nowMs - lastNag) >= upcomingNagMs) {
            return {
                type: 'upcoming-nag',
                label: `${Math.max(1, Math.ceil(hoursLeft))} horas`,
                stampKeys: ['lastUpcomingNagAt']
            };
        }
        return null;
    }

    const overdueHours = Math.floor((-msUntilDue) / HOUR_MS);
    if (!task.overdueSentAt) {
        return {
            type: 'overdue',
            overdueHours,
            stampKeys: ['overdueSentAt', 'lastOverdueNagAt']
        };
    }
    if (!nagAllowed) return null;
    const lastNag = Date.parse(task.lastOverdueNagAt || task.overdueSentAt);
    if (Number.isFinite(lastNag) && (nowMs - lastNag) >= overdueNagMs) {
        return {
            type: 'overdue-nag',
            overdueHours,
            stampKeys: ['lastOverdueNagAt']
        };
    }
    return null;
};
