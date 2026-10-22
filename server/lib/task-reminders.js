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
    { key: 'reminder24hSentAt', hours: 24, label: '24 horas' },
    { key: 'reminder8hSentAt', hours: 8, label: '8 horas' }
];

const ADMIN_ROLES = new Set(['super_admin', 'operations']);

export const collectReminderRecipients = ({
    assignees = [],
    task = {},
    users = []
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
    for (const user of users) {
        if (user?.isActive === false) continue;
        if (ADMIN_ROLES.has(user?.role)) add(user, 'admin');
    }

    return [...byEmail.values()].map((item) => ({
        ...item,
        primaryRole: item.roles.includes('assignee')
            ? 'assignee'
            : item.roles.includes('assigner')
                ? 'assigner'
                : 'admin'
    }));
};

export const selectReminderAction = ({
    task = {},
    dueMs,
    nowMs,
    upcomingNagMs = DAY_MS,
    overdueNagMs = DAY_MS
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
        if (!firstSent) return null;
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
