import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectReminderRecipients,
    computeDueAt,
    selectReminderAction
} from './task-reminders.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

test('collectReminderRecipients uniques admin, assigner and assignee', () => {
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
    assert.equal(recipients.find((item) => item.email === 'admin@cluster.ag').primaryRole, 'admin');
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

test('computeDueAt uses Honduras offset', () => {
    const due = computeDueAt({ date: '2026-09-30', time: '18:00' });
    assert.equal(due.iso, '2026-09-30T18:00:00-06:00');
});
