import { db } from '../db/knex.js';
import { env } from '../config/env.js';
import { listRecords, upsertRecord } from './records.js';
import { nowIso } from './time.js';
import { hasSmtpConfig, sendManagementTaskReminderEmail } from './email.js';
import { createHttpError } from './http.js';
import { normalizeEmail } from './text.js';
import { createRecordId } from './crypto.js';
import {
    HOUR_MS,
    collectReminderRecipients,
    computeDueAt,
    isReminderClosed,
    isWithinNagWindow,
    reminderContextCollection,
    reminderLookupTask,
    selectReminderAction
} from './task-reminders.js';
import { sendUsersPush } from './push-notifications.js';

const buildReminderPush = ({ action, taskTitle }) => {
    if (action.type === 'overdue' || action.type === 'overdue-nag') {
        return {
            title: 'Tarea vencida',
            body: `${taskTitle} sigue pendiente${action.overdueHours ? ` (vencida hace ${action.overdueHours} h)` : ''}.`
        };
    }
    return {
        title: `Tarea por vencer en ${action.label || 'unas horas'}`,
        body: taskTitle
    };
};

const TASK_CONFIGS = [
    {
        collectionName: 'management_tasks',
        reportKey: 'management',
        taskTypeLabel: 'tarea de gestion',
        roomLabel: 'Cluster OS - Sala de Gestion',
        doneLabel: 'Cerrado',
        contextCollection: 'users',
        defaultTime: '17:00',
        isClosed: (task) => isReminderClosed('management_tasks', task)
    },
    {
        collectionName: 'account_tasks',
        reportKey: 'account',
        taskTypeLabel: 'tarea de account',
        roomLabel: 'Cluster OS - Sala de Account',
        doneLabel: 'Aprobado internamente',
        contextCollection: 'managers',
        defaultTime: '17:00',
        isClosed: (task) => isReminderClosed('account_tasks', task)
    },
    {
        collectionName: 'editing',
        reportKey: 'editing',
        taskTypeLabel: 'tarea de edicion',
        roomLabel: 'Cluster OS - Sala de Edicion',
        doneLabel: 'Aprobado o Publicado',
        contextCollection: 'editors',
        defaultTime: '17:00',
        isClosed: (task) => isReminderClosed('editing', task)
    },
    {
        collectionName: 'events',
        reportKey: 'production',
        taskTypeLabel: 'tarea de produccion',
        roomLabel: 'Cluster OS - Sala de Produccion',
        doneLabel: 'Publicado',
        contextCollection: 'users',
        defaultTime: '17:00',
        include: (task) => String(task.type || '').toLowerCase() === 'production',
        isClosed: (task) => isReminderClosed('events', task)
    }
];

const ROLE_BY_COLLECTION = { managers: 'manager', editors: 'editor' };

const normalizeAssignee = (record = null, fallbackRole = '') => (
    record?.email
        ? { id: record.id, name: record.name || '', email: record.email, role: fallbackRole || record.role || '' }
        : null
);

const resolveAssignee = (task, config, recordsByCollection) => {
    const directUserId = task.assigneeUserId || '';
    if (directUserId) {
        const fromUsers = recordsByCollection.users.get(String(directUserId));
        const assignee = normalizeAssignee(fromUsers);
        if (assignee) return assignee;
    }

    const contextId = task.contextId || '';
    if (!contextId) return null;

    const fromContext = recordsByCollection[config.contextCollection].get(String(contextId));
    const contextAssignee = normalizeAssignee(fromContext, ROLE_BY_COLLECTION[config.contextCollection]);
    if (contextAssignee) return contextAssignee;

    const linkedUserId = fromContext?.userId || '';
    if (linkedUserId) {
        const fromLinkedUser = recordsByCollection.users.get(String(linkedUserId));
        const linkedAssignee = normalizeAssignee(fromLinkedUser);
        if (linkedAssignee) return linkedAssignee;
    }

    // Compatibilidad para datos antiguos con contextId apuntando a otra coleccion.
    for (const collectionName of ['users', 'managers', 'editors']) {
        if (collectionName === config.contextCollection) continue;
        const fallbackRecord = recordsByCollection[collectionName].get(String(contextId));
        const fallbackAssignee = normalizeAssignee(fallbackRecord, ROLE_BY_COLLECTION[collectionName]);
        if (fallbackAssignee) return fallbackAssignee;
    }

    return null;
};

const uniqueIds = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
)];

const resolveAssignees = (task, config, recordsByCollection) => {
    const ids = uniqueIds([
        ...(Array.isArray(task.assignees) ? task.assignees : []),
        task.contextId,
        task.assigneeUserId
    ]);
    const people = [];
    const seen = new Set();
    const candidates = ids.length
        ? ids.map((id) => ({ ...task, contextId: id, assigneeUserId: id }))
        : [task];
    for (const candidate of candidates) {
        const person = resolveAssignee(candidate, config, recordsByCollection);
        const email = normalizeEmail(person?.email);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        people.push(person);
    }
    return people;
};

const resolveClientName = (task, clientsById) => {
    if (!task.clientId) return '';
    const client = clientsById.get(String(task.clientId));
    return client?.name || '';
};

const buildTaskUrl = (task) => {
    const base = (env.appBaseUrl || '').replace(/\/+$/, '');
    return base ? `${base}/?task=${encodeURIComponent(task.id || '')}` : '';
};

const formatHonduras = (ms) => {
    try {
        return new Date(ms).toLocaleString('es-HN', {
            timeZone: 'America/Tegucigalpa',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return new Date(ms).toISOString();
    }
};

const updateTaskFlags = async (task, patch) => {
    await upsertRecord({
        collectionName: task.collectionName || 'management_tasks',
        recordId: task.id,
        payload: { ...patch, updatedAt: nowIso() },
        merge: true
    });
};

const stampFromAction = (action) => {
    const stamp = nowIso();
    return Object.fromEntries((action?.stampKeys || []).map((key) => [key, stamp]));
};

const sendReminderToRecipients = async ({ recipients, baseContext, action }) => {
    let sent = 0;
    const errors = [];
    for (const recipient of recipients) {
        try {
            await sendManagementTaskReminderEmail({
                ...baseContext,
                to: recipient.email,
                recipientName: recipient.name,
                recipientRole: recipient.primaryRole,
                variant: action.type,
                label: action.label,
                overdueHours: action.overdueHours
            });
            sent += 1;
        } catch (error) {
            errors.push({ email: recipient.email, message: error.message });
        }
    }
    return { sent, errors };
};

export const processManagementTaskReminders = async () => {
    if (env.isProduction && !hasSmtpConfig()) {
        throw createHttpError(503, 'SMTP no configurado.', 'email/not-configured');
    }
    const report = {
        checked: 0,
        byCollection: {},
        skippedNoDue: 0,
        skippedClosed: 0,
        skippedNoEmail: 0,
        skippedDisabled: 0,
        remindersSent: 0,
        overdueSent: 0,
        nagsSent: 0,
        errors: []
    };

    const now = Date.now();
    const nagAllowed = isWithinNagWindow(now, {
        startHour: env.compliance.windowStartHour,
        endHour: env.compliance.windowEndHour
    });
    const overdueNagMs = env.compliance.nagIntervalHours * HOUR_MS;

    const directoryCollections = ['users', 'managers', 'editors', 'clients'];
    const [directoryLists, taskLists] = await Promise.all([
        Promise.all(directoryCollections.map((collectionName) => listRecords({ collectionName }))),
        Promise.all(TASK_CONFIGS.map((config) => listRecords({ collectionName: config.collectionName })))
    ]);
    const recordsByCollection = Object.fromEntries(directoryCollections.map((collectionName, index) => [
        collectionName,
        new Map(directoryLists[index].map((record) => [String(record.id), record]))
    ]));
    const clients = [...recordsByCollection.clients.values()];

    for (const [configIndex, config] of TASK_CONFIGS.entries()) {
        const tasks = taskLists[configIndex];
        report.byCollection[config.collectionName] = { checked: tasks.length, remindersSent: 0, overdueSent: 0, nagsSent: 0 };

        for (const task of tasks) {
            report.checked += 1;

            if (typeof config.include === 'function' && !config.include(task)) {
                report.skippedClosed += 1;
                continue;
            }
            if (config.isClosed(task)) {
                report.skippedClosed += 1;
                continue;
            }
            if (task.notificationsEnabled === false) {
                report.skippedDisabled += 1;
                continue;
            }

            const due = computeDueAt(task, config);
            if (!due) {
                report.skippedNoDue += 1;
                continue;
            }

            let assignees = [];
            try {
                const lookup = reminderLookupTask(task, config.collectionName);
                assignees = resolveAssignees(lookup, {
                    ...config,
                    contextCollection: reminderContextCollection(config.collectionName, task)
                }, recordsByCollection);
            } catch (error) {
                report.errors.push({ collectionName: config.collectionName, taskId: task.id, step: 'resolveAssignee', message: error.message });
                continue;
            }

            const users = [...recordsByCollection.users.values()];
            const recipients = collectReminderRecipients({ assignees, task, users, clients });
            if (!recipients.length) {
                report.skippedNoEmail += 1;
                continue;
            }

            const action = selectReminderAction({
                task,
                dueMs: due.ms,
                nowMs: now,
                overdueNagMs,
                nagAllowed
            });
            if (!action) continue;

            const clientName = resolveClientName(task, recordsByCollection.clients);
            const taskUrl = buildTaskUrl(task);
            const dueHuman = formatHonduras(due.ms);
            const assigneeName = assignees.map((person) => person.name).filter(Boolean).join(', ')
                || assignees[0]?.name
                || '';

            const baseContext = {
                assigneeName,
                assignedByName: task.assignedByName || '',
                taskTypeLabel: config.taskTypeLabel,
                roomLabel: config.roomLabel,
                doneLabel: config.doneLabel,
                taskTitle: task.title || '(sin titulo)',
                taskNotes: task.notes || '',
                clientName,
                dueHuman,
                taskUrl,
                nagIntervalHours: env.compliance.nagIntervalHours
            };

            try {
                const delivery = await sendReminderToRecipients({ recipients, baseContext, action });
                for (const error of delivery.errors) {
                    report.errors.push({
                        collectionName: config.collectionName,
                        taskId: task.id,
                        step: 'sendEmail',
                        email: error.email,
                        message: error.message
                    });
                }
                const recipientEmails = new Set(recipients.map((item) => normalizeEmail(item.email)));
                const recipientUserIds = [...new Set(users
                    .filter((user) => user?.isActive !== false && recipientEmails.has(normalizeEmail(user.email)))
                    .map((user) => String(user.id || ''))
                    .filter(Boolean))];
                if (delivery.sent <= 0 && !recipientUserIds.length) continue;

                const push = buildReminderPush({ action, taskTitle: baseContext.taskTitle });
                if (recipientUserIds.length) {
                    const createdAt = nowIso();
                    await db('user_notifications').insert(recipientUserIds.map((userId) => ({
                        id: createRecordId(),
                        recipient_id: userId,
                        actor_id: 'system',
                        actor_name: 'Cluster',
                        type: 'task_reminder',
                        title: push.title.slice(0, 180),
                        body: push.body,
                        entity_type: 'task',
                        entity_id: String(task.id || '').slice(0, 120),
                        entity_collection: config.collectionName,
                        created_at: createdAt,
                        read_at: null
                    })));
                    await sendUsersPush({
                        userIds: recipientUserIds,
                        ...push,
                        data: { taskId: task.id || '', link: taskUrl }
                    });
                }

                const flags = stampFromAction(action);
                await updateTaskFlags({ ...task, collectionName: config.collectionName }, flags);
                Object.assign(task, flags);

                if (action.type === 'overdue') {
                    report.overdueSent += 1;
                    report.byCollection[config.collectionName].overdueSent += 1;
                } else if (action.type === 'overdue-nag') {
                    report.nagsSent += 1;
                    report.byCollection[config.collectionName].nagsSent += 1;
                } else {
                    report.remindersSent += 1;
                    report.byCollection[config.collectionName].remindersSent += 1;
                }
            } catch (error) {
                report.errors.push({ collectionName: config.collectionName, taskId: task.id, step: 'sendEmail', message: error.message });
            }
        }
    }

    return report;
};

export { computeDueAt } from './task-reminders.js';

// util para debug manual
export const _internals = { db };
