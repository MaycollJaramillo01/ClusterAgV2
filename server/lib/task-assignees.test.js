import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTaskAssignees } from './task-assignees.js';

test('task assignees keep a primary contextId', () => {
    const next = normalizeTaskAssignees({
        assignees: ['editor-2', 'editor-1', 'editor-2'],
        contextId: 'legacy'
    });
    assert.deepEqual(next.assignees, ['editor-2', 'editor-1']);
    assert.equal(next.contextId, 'editor-2');
});

test('missing assignees fall back to the single owner fields', () => {
    const next = normalizeTaskAssignees({ contextId: 'manager-1', assigneeUserId: 'user-1' });
    assert.deepEqual(next.assignees, ['manager-1', 'user-1']);
    assert.equal(next.contextId, 'manager-1');
});
