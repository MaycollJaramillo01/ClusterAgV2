import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assigneeUserIdsForTask,
    collectAfternoonDigest,
    hondurasHour,
    isAfternoonDigestHour
} from './afternoon-digest.js';

test('el aviso de la tarde solo corresponde a las 15:00 de Honduras', () => {
    const afternoon = new Date('2026-11-17T21:00:00.000Z');
    const morning = new Date('2026-11-17T15:00:00.000Z');
    assert.equal(hondurasHour(afternoon), 15);
    assert.equal(isAfternoonDigestHour(afternoon), true);
    assert.equal(isAfternoonDigestHour(morning), false);
});

test('junta las tareas abiertas de hoy por usuario', () => {
    const users = [{ id: 'user-1' }, { id: 'user-2' }];
    const managers = [{ id: 'manager-1', userId: 'user-1' }];
    const editors = [{ id: 'editor-1', userId: 'user-2' }];
    const digest = collectAfternoonDigest({
        today: '2026-11-17',
        users,
        managers,
        editors,
        accountTasks: [
            { id: 'a1', status: 'por_disenar', date: '2026-11-17', contextId: 'manager-1' },
            { id: 'a2', status: 'publicado', date: '2026-11-17', assigneeUserId: 'user-1' },
            { id: 'a3', status: 'por_disenar', date: '2026-11-18', assigneeUserId: 'user-1' }
        ],
        editingTasks: [
            { id: 'e1', status: 'en_edicion', date: '2026-11-17', contextId: 'editor-1' }
        ],
        managementTasks: []
    });
    const byUser = new Map(digest.map((item) => [item.userId, item.count]));
    assert.equal(byUser.get('user-1'), 1);
    assert.equal(byUser.get('user-2'), 1);
});

test('un responsable sin usuario de la app no recibe el aviso', () => {
    const ids = assigneeUserIdsForTask(
        { contextId: 'manager-1' },
        {
            usersById: new Map(),
            managersById: new Map([['manager-1', { id: 'manager-1', userId: 'user-missing' }]]),
            editorsById: new Map()
        }
    );
    assert.deepEqual(ids, []);
});
