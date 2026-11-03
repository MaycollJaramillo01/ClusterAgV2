import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TASK_DUE_TIME, prepareManagementTaskPayload } from './management-tasks.js';

const actor = { id: 'u-ana', name: 'Ana', email: 'ana@cluster.ag' };

test('prepareManagementTaskPayload sanitizes desarrollo status log', () => {
    const payload = prepareManagementTaskPayload({
        payload: {
            title: 'API de clientes',
            date: '2026-09-30',
            time: '18:00',
            contextId: 'u-dev',
            category: 'Desarrollo',
            devStatusLog: [
                { label: 'En review', note: 'PR #12', authorName: 'Luis' },
                { label: '  ' }
            ]
        },
        actor,
        isCreate: true
    });

    assert.equal(payload.category, 'desarrollo');
    assert.equal(payload.devStatusLog.length, 1);
    assert.equal(payload.devStatus, 'En review');
    assert.equal(payload.notificationsEnabled, true);
    assert.equal(payload.assignedByEmail, 'ana@cluster.ag');
});

test('a management task with a due date defaults to 17:00 when no time is supplied', () => {
    const payload = prepareManagementTaskPayload({
        payload: { title: 'Seguimiento', date: '2026-11-03', contextId: 'u-dev' },
        actor,
        isCreate: true
    });
    assert.equal(DEFAULT_TASK_DUE_TIME, '17:00');
    assert.equal(payload.time, '17:00');
});

test('an explicit management task time is preserved', () => {
    const payload = prepareManagementTaskPayload({
        payload: { title: 'Seguimiento', date: '2026-11-03', time: '13:45', contextId: 'u-dev' },
        actor,
        isCreate: true
    });
    assert.equal(payload.time, '13:45');
});

test('changing due date resets reminder flags including 24h and upcoming nags', () => {
    const payload = prepareManagementTaskPayload({
        payload: {
            date: '2026-10-01',
            time: '10:00'
        },
        existing: {
            title: 'Seguimiento',
            date: '2026-09-30',
            time: '18:00',
            contextId: 'u-dev',
            reminder24hSentAt: '2026-09-29T12:00:00.000Z',
            lastUpcomingNagAt: '2026-09-29T12:00:00.000Z',
            overdueSentAt: 'x'
        },
        actor
    });

    assert.equal(payload.reminder24hSentAt, null);
    assert.equal(payload.lastUpcomingNagAt, null);
    assert.equal(payload.overdueSentAt, null);
});
