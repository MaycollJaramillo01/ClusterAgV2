import { env } from '../config/env.js';
import {
    buildComplianceSnapshot,
    getSupervisorUsers
} from '../../src/app/utils/compliance.js';
import { getHondurasDateString, isWeekendDate } from '../../src/app/utils/date.js';
import { hasSmtpConfig, sendComplianceEmail } from './email.js';
import { createHttpError } from './http.js';
import { sendUsersPush } from './push-notifications.js';
import { listRecords, upsertRecord } from './records.js';
import { HOUR_MS, isWithinNagWindow } from './task-reminders.js';
import { normalizeEmail } from './text.js';
import { nowIso } from './time.js';

// Estado de los avisos ya enviados (idempotencia). No esta en
// COLLECTION_PERMISSIONS, por lo que la API publica de colecciones no la expone.
export const NOTICE_COLLECTION = 'compliance_notices';

const isActive = (record) => record?.isActive !== false;

const hasIdentityMatch = (user, record, linkedKey) => (
    String(user?.[linkedKey] || '') === String(record.id)
    || (record.userId && String(user?.id) === String(record.userId))
    || (normalizeEmail(user?.email) && normalizeEmail(user?.email) === normalizeEmail(record.email))
);

/**
 * Personas evaluables: usuarios activos que son Account Manager (rol `manager`
 * o `linkedManagerId`) o editores (rol `editor` o `linkedEditorId`), mas los
 * registros de `managers`/`editors` sin usuario vinculado pero con correo.
 */
export const buildComplianceProfiles = ({ users = [], managers = [], editors = [] } = {}) => {
    const profiles = [];
    for (const user of users) {
        if (!isActive(user) || !normalizeEmail(user.email)) continue;
        const isManager = user.role === 'manager' || Boolean(user.linkedManagerId);
        const isEditor = user.role === 'editor' || Boolean(user.linkedEditorId);
        if (!isManager && !isEditor) continue;
        profiles.push({
            id: user.id,
            userId: user.id,
            name: user.name || user.email,
            email: user.email,
            role: user.role || (isManager ? 'manager' : 'editor'),
            linkedManagerId: user.linkedManagerId || '',
            linkedEditorId: user.linkedEditorId || ''
        });
    }
    const addDirectory = (records, role, linkedKey) => {
        for (const record of records) {
            if (!isActive(record) || !normalizeEmail(record.email)) continue;
            if (users.some((user) => hasIdentityMatch(user, record, linkedKey))) continue;
            profiles.push({
                id: record.id,
                userId: record.userId || '',
                name: record.name || record.email,
                email: record.email,
                role,
                linkedManagerId: role === 'manager' ? record.id : '',
                linkedEditorId: role === 'editor' ? record.id : ''
            });
        }
    };
    addDirectory(managers, 'manager', 'linkedManagerId');
    addDirectory(editors, 'editor', 'linkedEditorId');
    return profiles;
};

const taskOwnerIds = (task = {}) => [
    task.contextId,
    task.assigneeUserId,
    ...(Array.isArray(task.assignees) ? task.assignees : [])
].filter(Boolean).map(String);

// Account Managers responsables de los clientes en los que trabajo la persona.
const managerKeysForEditor = (profile, editingTasks, clients, day) => {
    const ids = new Set([profile.id, profile.userId, profile.linkedEditorId].filter(Boolean).map(String));
    const clientIds = new Set(editingTasks
        .filter((task) => String(task.date || '').slice(0, 10) === day
            && taskOwnerIds(task).some((id) => ids.has(id)))
        .map((task) => String(task.clientId || ''))
        .filter(Boolean));
    const keys = new Set();
    for (const client of clients) {
        if (!clientIds.has(String(client.id))) continue;
        [client.managerId, client.managerUserId].filter(Boolean).forEach((id) => keys.add(String(id)));
    }
    return keys;
};

const dedupeRecipients = (recipients) => {
    const seen = new Set();
    return recipients.filter((recipient) => {
        const email = normalizeEmail(recipient.email);
        if (!email || seen.has(email)) return false;
        seen.add(email);
        return true;
    });
};

const toRecipient = (person, role) => ({
    email: person.email,
    name: person.name || '',
    role
});

/**
 * Decide, sin efectos secundarios, que avisos de cumplimiento corresponde
 * enviar ahora. Reglas:
 * - Account Manager por debajo del % de semana transcurrido: aviso al propio
 *   Account Manager cada `nagIntervalHours` dentro del horario laboral, y a sus
 *   superiores una vez al dia.
 * - Editor que no llego a la meta del dia habil anterior: un unico aviso al dia
 *   (al editor y a sus superiores).
 * - Solo de lunes a viernes (Honduras) y dentro del horario laboral.
 */
export const planComplianceNotices = ({
    users = [],
    managers = [],
    editors = [],
    clients = [],
    accountTasks = [],
    editingTasks = [],
    managementTasks = [],
    notices = [],
    nowMs = Date.now(),
    nagIntervalHours = env.compliance.nagIntervalHours,
    windowStartHour = env.compliance.windowStartHour,
    windowEndHour = env.compliance.windowEndHour
} = {}) => {
    const today = getHondurasDateString(new Date(nowMs));
    const plan = { today, evaluated: 0, skipped: '', notices: [] };
    if (isWeekendDate(today)) return { ...plan, skipped: 'weekend' };
    if (!isWithinNagWindow(nowMs, { startHour: windowStartHour, endHour: windowEndHour })) {
        return { ...plan, skipped: 'outside-window' };
    }

    const lastSentById = new Map(notices.map((notice) => [String(notice.id), Date.parse(notice.lastSentAt)]));
    const intervalMs = Math.max(1, Number(nagIntervalHours) || 6) * HOUR_MS;
    const isDue = (id, minGapMs) => {
        const last = lastSentById.get(id);
        return !Number.isFinite(last) || (nowMs - last) >= minGapMs;
    };

    for (const profile of buildComplianceProfiles({ users, managers, editors })) {
        plan.evaluated += 1;
        const snapshot = buildComplianceSnapshot({
            profile,
            accountTasks,
            editingTasks,
            managementTasks,
            today,
            nowMs
        });
        const excludeIds = [profile.id, profile.userId];
        const self = toRecipient(profile, 'self');

        const { accountWeekly, editorDaily } = snapshot;
        if (accountWeekly.applies && accountWeekly.behind) {
            const base = {
                kind: 'account-pace',
                profile,
                subjectName: profile.name,
                metrics: {
                    elapsedPercent: accountWeekly.elapsedPercent,
                    progressPercent: accountWeekly.progressPercent,
                    completed: accountWeekly.completed,
                    assigned: accountWeekly.assigned,
                    penalty: accountWeekly.penalty
                }
            };
            const selfId = `account-pace:${profile.id}:${accountWeekly.weekStart}`;
            if (isDue(selfId, intervalMs)) {
                plan.notices.push({ ...base, id: selfId, audience: 'self', recipients: [self] });
            }
            const supervisorsId = `account-pace-supervisors:${profile.id}:${today}`;
            if (isDue(supervisorsId, 24 * HOUR_MS)) {
                const supervisors = getSupervisorUsers({
                    role: profile.role,
                    users,
                    managerKeys: new Set(),
                    excludeIds
                });
                const recipients = dedupeRecipients(supervisors.map((user) => toRecipient(user, 'supervisor')));
                if (recipients.length) {
                    plan.notices.push({ ...base, id: supervisorsId, audience: 'supervisors', recipients });
                }
            }
        }

        if (editorDaily.applies && editorDaily.missed) {
            const id = `editor-daily:${profile.id}:${today}`;
            if (isDue(id, 24 * HOUR_MS)) {
                const supervisors = getSupervisorUsers({
                    role: profile.role,
                    users,
                    managerKeys: managerKeysForEditor(profile, editingTasks, clients, editorDaily.day),
                    excludeIds
                });
                const recipients = dedupeRecipients([
                    self,
                    ...supervisors.map((user) => toRecipient(user, 'supervisor'))
                ]);
                plan.notices.push({
                    id,
                    kind: 'editor-daily',
                    audience: 'all',
                    profile,
                    subjectName: profile.name,
                    metrics: {
                        day: editorDaily.day,
                        completed: editorDaily.completed,
                        target: editorDaily.target,
                        penalty: editorDaily.penalty
                    },
                    recipients
                });
            }
        }
    }
    return plan;
};

const buildNoticePush = (notice) => (notice.kind === 'editor-daily'
    ? {
        title: 'Meta diaria no cumplida',
        body: `${notice.subjectName}: ${notice.metrics.completed} de ${notice.metrics.target} piezas nuevas el ${notice.metrics.day}.`
    }
    : {
        title: 'Ritmo semanal por debajo de lo esperado',
        body: `${notice.subjectName}: ${notice.metrics.progressPercent}% de publicaciones con ${notice.metrics.elapsedPercent}% de la semana transcurrida.`
    });

const buildAppUrl = () => (env.appBaseUrl || '').replace(/\/+$/, '');

export const processComplianceEvents = async ({ nowMs = Date.now() } = {}) => {
    if (env.isProduction && !hasSmtpConfig()) {
        throw createHttpError(503, 'SMTP no configurado.', 'email/not-configured');
    }

    const [users, managers, editors, clients, accountTasks, editingTasks, managementTasks, notices] = await Promise.all([
        listRecords({ collectionName: 'users' }),
        listRecords({ collectionName: 'managers' }),
        listRecords({ collectionName: 'editors' }),
        listRecords({ collectionName: 'clients' }),
        listRecords({ collectionName: 'account_tasks' }),
        listRecords({ collectionName: 'editing' }),
        listRecords({ collectionName: 'management_tasks' }),
        listRecords({ collectionName: NOTICE_COLLECTION })
    ]);

    const plan = planComplianceNotices({
        users,
        managers,
        editors,
        clients,
        accountTasks,
        editingTasks,
        managementTasks,
        notices,
        nowMs
    });
    const report = {
        today: plan.today,
        skipped: plan.skipped,
        evaluated: plan.evaluated,
        noticesPlanned: plan.notices.length,
        emailsSent: 0,
        byKind: {},
        errors: []
    };

    const appUrl = buildAppUrl();
    for (const notice of plan.notices) {
        let sent = 0;
        for (const recipient of notice.recipients) {
            try {
                await sendComplianceEmail({
                    kind: notice.kind,
                    to: recipient.email,
                    recipientRole: recipient.role,
                    recipientName: recipient.name,
                    subjectName: notice.subjectName,
                    metrics: notice.metrics,
                    nagIntervalHours: env.compliance.nagIntervalHours,
                    appUrl
                });
                sent += 1;
            } catch (error) {
                report.errors.push({ noticeId: notice.id, email: recipient.email, message: error.message });
            }
        }
        if (sent <= 0) continue;

        report.emailsSent += sent;
        const kindKey = `${notice.kind}:${notice.audience}`;
        report.byKind[kindKey] = (report.byKind[kindKey] || 0) + sent;

        const previous = notices.find((item) => String(item.id) === notice.id);
        await upsertRecord({
            collectionName: NOTICE_COLLECTION,
            recordId: notice.id,
            payload: {
                kind: notice.kind,
                audience: notice.audience,
                profileId: notice.profile.id,
                lastSentAt: nowIso(),
                sentCount: Number(previous?.sentCount || 0) + 1
            },
            merge: true
        });

        const emails = new Set(notice.recipients.map((recipient) => normalizeEmail(recipient.email)));
        await sendUsersPush({
            userIds: users
                .filter((user) => isActive(user) && emails.has(normalizeEmail(user.email)))
                .map((user) => user.id),
            ...buildNoticePush(notice),
            data: { kind: notice.kind, link: appUrl }
        });
    }

    return report;
};
