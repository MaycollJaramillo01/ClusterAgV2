import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareClientsByPriority,
    getClientPriority,
    groupClientsByPriority,
    normalizeClientPriority,
    shouldNotifyClientPriority
} from './client-priority.js';

test('client priority falls back to ninguna', () => {
    assert.equal(normalizeClientPriority(''), 'ninguna');
    assert.equal(normalizeClientPriority('critica'), 'critica');
    assert.equal(getClientPriority({}).id, 'ninguna');
});

test('critical and high flags notify the assignee', () => {
    assert.equal(shouldNotifyClientPriority('critica'), true);
    assert.equal(shouldNotifyClientPriority('alta'), true);
    assert.equal(shouldNotifyClientPriority('media'), false);
});

test('clients sort and group by configured hierarchy', () => {
    const clients = [
        { id: 'b', name: 'Beta', priorityFlag: 'baja' },
        { id: 'a', name: 'Alfa', priorityFlag: 'critica' },
        { id: 'c', name: 'Cero', priorityFlag: 'critica' }
    ];
    const sorted = [...clients].sort(compareClientsByPriority);
    assert.deepEqual(sorted.map((item) => item.id), ['a', 'c', 'b']);
    const groups = groupClientsByPriority(sorted);
    assert.equal(groups[0].flag.id, 'critica');
    assert.equal(groups[0].clients.length, 2);
});
