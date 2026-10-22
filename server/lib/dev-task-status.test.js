import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isDevelopmentCategory,
    latestDevStatusLabel,
    normalizeDevStatusLog
} from './dev-task-status.js';

test('isDevelopmentCategory only matches desarrollo', () => {
    assert.equal(isDevelopmentCategory('desarrollo'), true);
    assert.equal(isDevelopmentCategory(' Desarrollo '), true);
    assert.equal(isDevelopmentCategory('seguimiento'), false);
});

test('normalizeDevStatusLog keeps valid entries and drops empty labels', () => {
    const log = normalizeDevStatusLog([
        { id: 'a1', label: 'En review', note: 'PR abierto', authorName: 'Ana', createdAt: '2026-09-29T12:00:00.000Z' },
        { label: '   ' },
        { id: 'a1', label: 'duplicado' },
        { status: 'QA' }
    ]);
    assert.equal(log.length, 2);
    assert.equal(log[0].label, 'En review');
    assert.equal(log[0].note, 'PR abierto');
    assert.equal(log[1].label, 'QA');
});

test('latestDevStatusLabel returns the last entry', () => {
    assert.equal(latestDevStatusLabel([
        { label: 'Backlog' },
        { label: 'En review' }
    ]), 'En review');
    assert.equal(latestDevStatusLabel([]), '');
});
