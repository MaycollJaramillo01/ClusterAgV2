import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectReminderRecipients,
    computeDueAt,
    isReminderClosed,
    isWithinNagWindow,
    reminderContextCollection,
    reminderLookupTask,
    selectReminderAction
} from './task-reminders.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test('collectReminderRecipients uniques supervisor, assigner and assignee', () => {
    const recipients = collectReminderRecipients({
        assignees: [
            { name: 'Luis', email: 'luis@cluster.ag' },
            { name: 'Luis copy', email: ' luis@cluster.ag ' }
        ],
        task: {
            assignedByEmail: 'ana@cluster.ag',
            assignedByName: 'Ana',
            assignedByUserId: 'u-ana'
        },
        users: [
            { id: 'u-ana', name: 'Ana Vega', email: 'ana@cluster.ag', role: 'management' },
            { id: 'u-admin', name: 'Admin', email: 'admin@cluster.ag', role: 'super_admin' },
            { id: 'u-ops', name: 'Ops', email: 'ops@cluster.ag', role: 'operations' },
            { id: 'u-inactive', name: 'Viejo', email: 'old@cluster.ag', role: 'super_admin', isActive: false },
            { id: 'u-editor', name: 'Ed', email: 'ed@cluster.ag', role: 'editor' }
        ]
    });

    const emails = recipients.map((item) => item.email).sort();
    assert.deepEqual(emails, ['admin@cluster.ag', 'ana@cluster.ag', 'luis@cluster.ag', 'ops@cluster.ag']);
    assert.equal(recipients.find((item) => item.email === 'luis@cluster.ag').primaryRole, 'assignee');
    assert.equal(recipients.find((item) => item.email === 'ana@cluster.ag').primaryRole, 'assigner');
    assert.equal(recipients.find((item) => item.email === 'admin@cluster.ag').primaryRole, 'supervisor');
});

const hierarchyUsers = [
    { id: 'u-admin', name: 'Admin', email: 'admin@cluster.ag', role: 'super_admin' },
    { id: 'u-ops', name: 'Ops', email: 'ops@cluster.ag', role: 'operations' },
    { id: 'u-mgmt', name: 'Gestion', email: 'mgmt@cluster.ag', role: 'management' },
    { id: 'u-am1', name: 'AM Uno', email: 'am1@cluster.ag', role: 'manager', linkedManagerId: 'm1' },
    { id: 'u-am2', name: 'AM Dos', email: 'am2@cluster.ag', role: 'manager', linkedManagerId: 'm2' },
    { id: 'u-ed', name: 'Edi', email: 'edi@cluster.ag', role: 'editor' }
];
const emailsOf = (recipients) => recipients.map((item) => item.email).sort();

test('collectReminderRecipients escala al Account Manager hacia management, operations y super_admin', () => {
    const recipients = collectReminderRecipients({
        assignees: [{ name: 'AM Uno', email: 'am1@cluster.ag', role: 'manager' }],
        task: { clientId: 'c1' },
        users: hierarchyUsers,
        clients: [{ id: 'c1', managerId: 'm1' }]
    });
    assert.deepEqual(emailsOf(recipients), [
        'admin@cluster.ag', 'am1@cluster.ag', 'mgmt@cluster.ag', 'ops@cluster.ag'
    ]);
    assert.equal(recipients.find((item) => item.email === 'mgmt@cluster.ag').primaryRole, 'supervisor');
});

test('collectReminderRecipients avisa a los Account Managers solo si manejan el cliente del editor', () => {
    const recipients = collectReminderRecipients({
        assignees: [{ name: 'Edi', email: 'edi@cluster.ag', role: 'editor' }],
        task: { clientId: 'c1' },
        users: hierarchyUsers,
        clients: [{ id: 'c1', managerId: 'm1' }, { id: 'c2', managerId: 'm2' }]
    });
    assert.deepEqual(emailsOf(recipients), [
        'admin@cluster.ag', 'am1@cluster.ag', 'edi@cluster.ag', 'mgmt@cluster.ag', 'ops@cluster.ag'
    ]);
});

test('el rol del responsable se deduce del usuario por correo cuando no viene informado', () => {
    const recipients = collectReminderRecipients({
        assignees: [{ name: 'Edi', email: 'edi@cluster.ag' }],
        task: {},
        users: hierarchyUsers,
        clients: []
    });
    assert.deepEqual(emailsOf(recipients), [
        'admin@cluster.ag', 'edi@cluster.ag', 'mgmt@cluster.ag', 'ops@cluster.ag'
    ]);
});

test('isWithinNagWindow usa el horario laboral de Honduras', () => {
    assert.equal(isWithinNagWindow(Date.parse('2026-10-28T06:30:00-06:00')), false);
    assert.equal(isWithinNagWindow(Date.parse('2026-10-28T07:00:00-06:00')), true);
    assert.equal(isWithinNagWindow(Date.parse('2026-10-28T18:59:00-06:00')), true);
    assert.equal(isWithinNagWindow(Date.parse('2026-10-28T19:00:00-06:00')), false);
    assert.equal(isWithinNagWindow(Date.parse('2026-10-28T10:00:00-06:00'), { startHour: 11, endHour: 12 }), false);
});

test('los recordatorios continuos de vencida respetan intervalo y horario', () => {
    const nowMs = Date.parse('2026-10-28T14:00:00-06:00');
    const task = {
        overdueSentAt: '2026-10-28T06:00:00-06:00',
        lastOverdueNagAt: '2026-10-28T07:30:00-06:00'
    };
    const dueMs = nowMs - (30 * HOUR_MS);
    const base = { task, dueMs, nowMs, overdueNagMs: 6 * HOUR_MS };
    assert.equal(selectReminderAction({ ...base })?.type, 'overdue-nag');
    assert.equal(selectReminderAction({ ...base, nagAllowed: false }), null);
    assert.equal(selectReminderAction({ ...base, overdueNagMs: 8 * HOUR_MS }), null);
    // La primera notificacion de vencida no depende del horario.
    assert.equal(selectReminderAction({ task: {}, dueMs, nowMs, nagAllowed: false })?.type, 'overdue');
});

test('selectReminderAction sends 24h then 8h then recurrent nags', () => {
    const nowMs = Date.parse('2026-09-30T13:00:00.000Z');
    const dueMs = nowMs + (20 * HOUR_MS);

    const upcoming24 = selectReminderAction({ task: {}, dueMs, nowMs });
    assert.equal(upcoming24?.type, 'upcoming');
    assert.equal(upcoming24?.label, '24 horas');
    assert.ok(upcoming24.stampKeys.includes('reminder24hSentAt'));
    assert.equal(upcoming24.stampKeys.includes('reminder8hSentAt'), false);

    const tooSoonFor8h = selectReminderAction({
        task: { reminder24hSentAt: '2026-09-30T12:00:00.000Z', lastUpcomingNagAt: '2026-09-30T12:00:00.000Z' },
        dueMs,
        nowMs
    });
    assert.equal(tooSoonFor8h, null);

    const dueIn6h = nowMs + (6 * HOUR_MS);
    const upcoming8 = selectReminderAction({
        task: { reminder24hSentAt: '2026-09-29T13:00:00.000Z' },
        dueMs: dueIn6h,
        nowMs
    });
    assert.equal(upcoming8?.type, 'upcoming');
    assert.equal(upcoming8?.label, '8 horas');

    const upcomingNag = selectReminderAction({
        task: {
            reminder24hSentAt: '2026-09-29T12:00:00.000Z',
            lastUpcomingNagAt: '2026-09-29T12:00:00.000Z'
        },
        dueMs,
        nowMs,
        upcomingNagMs: DAY_MS
    });
    assert.equal(upcomingNag?.type, 'upcoming-nag');

    const overdue = selectReminderAction({ task: {}, dueMs: nowMs - HOUR_MS, nowMs });
    assert.equal(overdue?.type, 'overdue');

    const overdueNag = selectReminderAction({
        task: {
            overdueSentAt: '2026-09-29T12:00:00.000Z',
            lastOverdueNagAt: '2026-09-29T12:00:00.000Z'
        },
        dueMs: nowMs - (30 * HOUR_MS),
        nowMs
    });
    assert.equal(overdueNag?.type, 'overdue-nag');
});

test('una entrega ya medida deja de avisarse y la revisión pasa al account', () => {
    assert.equal(isReminderClosed('account_tasks', { status: 'aprobado_internamente' }), true);
    assert.equal(isReminderClosed('account_tasks', { status: 'por_disenar' }), false);
    assert.equal(isReminderClosed('editing', { status: 'revision_interna' }), false);
    const review = reminderLookupTask({
        status: 'revision_interna',
        contextId: 'editor-1',
        assigneeUserId: 'user-editor',
        accountId: 'manager-1'
    }, 'editing');
    assert.deepEqual(review.assignees, ['manager-1']);
    assert.equal(review.assigneeUserId, '');
    assert.equal(reminderContextCollection('editing', review), 'managers');
    assert.equal(reminderContextCollection('editing', { status: 'en_edicion' }), 'editors');
});

test('computeDueAt uses Honduras offset', () => {
    const due = computeDueAt({ date: '2026-09-30', time: '18:00' });
    assert.equal(due.iso, '2026-09-30T18:00:00-06:00');
});
