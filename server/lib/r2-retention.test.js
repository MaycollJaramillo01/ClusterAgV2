import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectExpiredAttachmentJobs,
    getR2RetentionMs,
    isExpiredStoredAttachment,
    splitExpiredAttachments
} from './r2-retention-policy.js';

const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
const now = Date.parse('2026-09-26T12:00:00.000Z');

test('R2 retention defaults to five days', () => {
    assert.equal(getR2RetentionMs(5), FIVE_DAYS);
    assert.equal(getR2RetentionMs(0), FIVE_DAYS);
});

test('only stored attachments older than the window expire', () => {
    const fresh = {
        key: 'tasks/editing/task-1/att1/corte.mp4',
        storage: 'r2',
        uploadedAt: '2026-09-24T12:00:00.000Z'
    };
    const stale = {
        key: 'tasks/editing/task-1/att2/master.mp4',
        storage: 'r2',
        uploadedAt: '2026-09-20T12:00:00.000Z'
    };
    const embedded = {
        data: 'data:image/png;base64,aaa',
        uploadedAt: '2026-09-01T12:00:00.000Z'
    };

    assert.equal(isExpiredStoredAttachment(fresh, { now, retentionMs: FIVE_DAYS }), false);
    assert.equal(isExpiredStoredAttachment(stale, { now, retentionMs: FIVE_DAYS }), true);
    assert.equal(isExpiredStoredAttachment(embedded, { now, retentionMs: FIVE_DAYS }), false);
});

test('missing uploadedAt can fall back to the record createdAt', () => {
    const attachment = {
        key: 'chats/client-1/att9/pieza.mp4',
        storage: 'r2'
    };
    assert.equal(isExpiredStoredAttachment(attachment, { now, retentionMs: FIVE_DAYS }), false);
    assert.equal(isExpiredStoredAttachment(attachment, {
        now,
        retentionMs: FIVE_DAYS,
        fallbackIso: '2026-09-18T12:00:00.000Z'
    }), true);
});

test('collectExpiredAttachmentJobs keeps fresh files and lists stale ones', () => {
    const jobs = collectExpiredAttachmentJobs([{
        collectionName: 'editing',
        id: 'task-1',
        createdAt: '2026-09-01T12:00:00.000Z',
        attachments: [
            { id: 'fresh', key: 'tasks/editing/task-1/fresh/a.mp4', storage: 'r2', uploadedAt: '2026-09-25T12:00:00.000Z' },
            { id: 'stale', key: 'tasks/editing/task-1/stale/b.mp4', storage: 'r2', uploadedAt: '2026-09-10T12:00:00.000Z' },
            { id: 'local', data: 'data:image/png;base64,aaa' }
        ]
    }], { now, retentionMs: FIVE_DAYS });

    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].expired.map((item) => item.id), ['stale']);
    assert.deepEqual(jobs[0].kept.map((item) => item.id), ['fresh', 'local']);
});

test('splitExpiredAttachments ignores empty lists', () => {
    assert.deepEqual(splitExpiredAttachments(undefined, { now, retentionMs: FIVE_DAYS }), {
        expired: [],
        kept: []
    });
});
