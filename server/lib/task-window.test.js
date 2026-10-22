import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getBaseTaskWindow,
    recordMatchesTaskWindow
} from './task-window.js';

test('task window covers last three months through the end of next month', () => {
    const window = getBaseTaskWindow(new Date(2026, 8, 29));
    assert.equal(window.dateFrom, '2026-06-01');
    assert.equal(window.dateTo, '2026-10-31');
});

test('open tasks without a date stay in the working set', () => {
    const window = getBaseTaskWindow(new Date(2026, 8, 29));
    assert.equal(
        recordMatchesTaskWindow(
            { id: 'open', status: 'editar' },
            'editing',
            { ...window, includeOpenOutside: true }
        ),
        true
    );
    assert.equal(
        recordMatchesTaskWindow(
            { id: 'done', status: 'publicado' },
            'editing',
            { ...window, includeOpenOutside: true }
        ),
        false
    );
});

test('open high-priority tasks dated next month stay visible at month end', () => {
    const window = getBaseTaskWindow(new Date(2026, 8, 29));
    assert.equal(
        recordMatchesTaskWindow(
            { id: 'oct', date: '2026-10-01', status: 'por_disenar', priority: 'alta' },
            'account_tasks',
            { ...window, includeOpenOutside: true }
        ),
        true
    );
});
