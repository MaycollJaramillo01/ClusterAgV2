import { db } from '../db/knex.js';
import { createRecordId } from './crypto.js';
import { listRecords } from './records.js';
import { sendUsersPush } from './push-notifications.js';
import { nowIso } from './time.js';

const CLOSED_STATUS = {
    account_tasks: new Set(['publicado', 'aprobado_internamente']),
    editing: new Set(['aprobado', 'publicado']),
    management_tasks: new Set(['cerrado'])
};

export const hondurasDateKey = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tegucigalpa',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).format(now);

export const hondurasHour = (now = new Date()) => {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Tegucigalpa',
        hour: '2-digit',
        hourCycle: 'h23'
    }).format(now);
    return Number(String(hour).trim());
};

export const isAfternoonDigestHour = (now = new Date()) => hondurasHour(now) === 15;

const indexById = (records = []) => new Map(records.map((record) => [String(record.id), record]));

export const assigneeUserIdsForTask = (task = {}, { usersById, managersById, editorsById }) => {
    const ids = new Set();
    const consider = (raw) => {
        const id = String(raw || '').trim();
        if (!id) return;
        if (usersById.has(id)) ids.add(id);
        const manager = managersById.get(id);
        const managerUserId = String(manager?.userId || '').trim();
        if (managerUserId && usersById.has(managerUserId)) ids.add(managerUserId);
        const editor = editorsById.get(id);
        const editorUserId = String(editor?.userId || '').trim();
        if (editorUserId && usersById.has(editorUserId)) ids.add(editorUserId);
    };
    consider(task.assigneeUserId);
    consider(task.contextId);
    for (const assigneeId of Array.isArray(task.assignees) ? task.assignees : []) consider(assigneeId);
    return [...ids];
};

const digestTask = (collectionName, task = {}) => {
    if (collectionName === 'editing' && task.status === 'revision_interna') {
        const accountId = String(task.accountId || '').trim();
        return { ...task, assigneeUserId: '', contextId: accountId, assignees: accountId ? [accountId] : [] };
    }
    return task;
};

export const afternoonDigestBody = ({ todayCount = 0, overdueCount = 0 } = {}) => {
    const today = Math.max(0, Number(todayCount) || 0);
    const overdue = Math.max(0, Number(overdueCount) || 0);
    const todayText = today === 1
        ? 'Te queda 1 tarea para hoy'
        : `Te quedan ${today} tareas para hoy`;
    const overdueText = overdue === 1 ? '1 vencida' : `${overdue} vencidas`;
    if (today && overdue) return `${todayText} y ${overdueText}.`;
    if (today) return `${todayText}.`;
    if (overdue === 1) return 'Te queda 1 tarea vencida.';
    if (overdue) return `Te quedan ${overdue} tareas vencidas.`;
    return '';
};

export const collectAfternoonDigest = ({
    accountTasks = [],
    editingTasks = [],
    managementTasks = [],
    users = [],
    managers = [],
    editors = [],
    today
} = {}) => {
    const usersById = indexById(users);
    const managersById = indexById(managers);
    const editorsById = indexById(editors);
    const directory = { usersById, managersById, editorsById };
    const grouped = new Map();
    const collections = [
        ['account_tasks', accountTasks],
        ['editing', editingTasks],
        ['management_tasks', managementTasks]
    ];
    for (const [collectionName, tasks] of collections) {
        for (const task of tasks) {
            if (CLOSED_STATUS[collectionName].has(String(task?.status || ''))) continue;
            const date = String(task?.date || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) continue;
            const taskId = String(task?.id || '').trim();
            if (!taskId) continue;
            const isToday = date === today;
            for (const userId of assigneeUserIdsForTask(digestTask(collectionName, task), directory)) {
                const current = grouped.get(userId) || {
                    userId, count: 0, todayCount: 0, overdueCount: 0, taskId, collectionName
                };
                current.count += 1;
                if (isToday) current.todayCount += 1;
                else current.overdueCount += 1;
                grouped.set(userId, current);
            }
        }
    }
    return [...grouped.values()];
};

export const processAfternoonDigest = async ({ now = new Date() } = {}) => {
    if (!isAfternoonDigestHour(now)) {
        return { skipped: true, reason: 'outside-hour', sent: 0 };
    }
    const today = hondurasDateKey(now);
    const dayStart = new Date(`${today}T00:00:00-06:00`).toISOString();
    const [accountTasks, editingTasks, managementTasks, users, managers, editors, alreadySent] = await Promise.all([
        listRecords({ collectionName: 'account_tasks' }),
        listRecords({ collectionName: 'editing' }),
        listRecords({ collectionName: 'management_tasks' }),
        listRecords({ collectionName: 'users' }),
        listRecords({ collectionName: 'managers' }),
        listRecords({ collectionName: 'editors' }),
        db('user_notifications')
            .where({ type: 'afternoon_digest' })
            .andWhere('created_at', '>=', dayStart)
            .select('recipient_id')
    ]);
    const sentIds = new Set(alreadySent.map((row) => String(row.recipient_id)));
    const pending = collectAfternoonDigest({
        accountTasks,
        editingTasks,
        managementTasks,
        users,
        managers,
        editors,
        today
    }).filter((item) => item.count > 0 && !sentIds.has(item.userId));
    const createdAt = nowIso();
    for (const item of pending) {
        const body = afternoonDigestBody(item);
        await db('user_notifications').insert({
            id: createRecordId(),
            recipient_id: item.userId,
            actor_id: 'system',
            actor_name: 'Cluster',
            type: 'afternoon_digest',
            title: 'Tareas para hoy',
            body,
            entity_type: 'task',
            entity_id: item.taskId,
            entity_collection: item.collectionName,
            created_at: createdAt,
            read_at: null
        });
        await sendUsersPush({
            userIds: [item.userId],
            title: 'Tareas para hoy',
            body,
            data: { type: 'afternoon_digest' }
        });
    }
    return { skipped: false, today, sent: pending.length };
};
