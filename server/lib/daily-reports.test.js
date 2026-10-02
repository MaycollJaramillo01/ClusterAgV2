import test from 'node:test';
import assert from 'node:assert/strict';
import {
    summarizeRolePerformance,
    shouldSendDailyRoleReport,
    getDailyReportWindow,
    getTaskCompletionIso,
    mergeGeneralPerformance
} from './daily-reports.js';

test('getDailyReportWindow at 6am covers previous 24h ending at cutoff', () => {
    const window = getDailyReportWindow(Date.parse('2026-08-07T06:00:00-06:00'));
    assert.equal(window.startMs, Date.parse('2026-08-06T06:00:00-06:00'));
    assert.equal(window.endMs, Date.parse('2026-08-07T06:00:00-06:00'));
    assert.equal(window.labelDayKey, '2026-08-06');
});

test('getDailyReportWindow before 6am uses the prior completed cutoff', () => {
    const window = getDailyReportWindow(Date.parse('2026-08-07T05:59:00-06:00'));
    assert.equal(window.startMs, Date.parse('2026-08-05T06:00:00-06:00'));
    assert.equal(window.endMs, Date.parse('2026-08-06T06:00:00-06:00'));
});

test('summarizeRolePerformance includes early-morning creations before 6am cutoff', () => {
    const people = [
        { id: 'editor-1', name: 'Ana', email: 'ana@example.com', userId: 'user-1' },
        { id: 'editor-2', name: 'Luis', email: 'luis@example.com', userId: 'user-2' }
    ];

    const tasks = [
        {
            id: 't1',
            contextId: 'editor-1',
            status: 'aprobado',
            date: '2026-08-06',
            createdAt: '2026-08-06T10:00:00-06:00',
            updatedAt: '2026-08-06T10:00:00-06:00'
        },
        {
            id: 't-madrugada',
            contextId: 'editor-1',
            status: 'pendiente',
            date: '2026-08-07',
            createdAt: '2026-08-07T02:00:00-06:00',
            updatedAt: '2026-08-07T02:00:00-06:00'
        },
        {
            id: 't-before-window',
            contextId: 'editor-2',
            status: 'pendiente',
            date: '2026-08-06',
            createdAt: '2026-08-06T05:59:00-06:00',
            updatedAt: '2026-08-06T05:59:00-06:00'
        },
        {
            id: 't-at-end-excluded',
            contextId: 'editor-2',
            status: 'aprobado',
            date: '2026-08-07',
            createdAt: '2026-08-07T06:00:00-06:00',
            updatedAt: '2026-08-07T06:00:00-06:00'
        }
    ];

    const result = summarizeRolePerformance({
        people,
        tasks,
        collectionName: 'editing',
        closedStatuses: new Set(['aprobado', 'publicado']),
        now: Date.parse('2026-08-07T06:00:00-06:00')
    });

    assert.equal(result.people[0].created, 2);
    assert.equal(result.people[0].approved, 1);
    assert.equal(result.people[0].inProgress, 1);
    assert.equal(result.people[1].created, 0);
    assert.equal(result.totals.created, 2);
    assert.equal(result.window.labelDayKey, '2026-08-06');
});

test('summarizeRolePerformance ignores due date when createdAt is outside the window', () => {
    const people = [
        { id: 'editor-1', name: 'Ana', email: 'ana@example.com' }
    ];

    const tasks = [
        {
            id: 'due-in-period-created-before',
            contextId: 'editor-1',
            status: 'pendiente',
            date: '2026-08-06',
            createdAt: '2026-08-05T15:00:00-06:00'
        },
        {
            id: 'due-before-created-in-period',
            contextId: 'editor-1',
            status: 'aprobado',
            date: '2026-08-05',
            createdAt: '2026-08-06T09:00:00-06:00'
        }
    ];

    const result = summarizeRolePerformance({
        people,
        tasks,
        collectionName: 'editing',
        closedStatuses: new Set(['aprobado', 'publicado']),
        now: Date.parse('2026-08-07T06:00:00-06:00')
    });

    assert.equal(result.people[0].created, 1);
    assert.equal(result.people[0].approved, 1);
    assert.equal(result.people[0].inProgress, 0);
    assert.equal(result.totals.created, 1);
});

test('shouldSendDailyRoleReport skips Sundays', () => {
    assert.equal(shouldSendDailyRoleReport(new Date('2026-08-09T06:00:00-06:00')), false);
    assert.equal(shouldSendDailyRoleReport(new Date('2026-08-07T06:00:00-06:00')), true);
});

test('summarizeRolePerformance merges person.id and person.userId tasks without duplicates', () => {
    const people = [
        { id: 'manager-1', userId: 'user-1', name: 'Maria' }
    ];

    const tasks = [
        {
            id: 'a1',
            contextId: 'manager-1',
            date: '2026-08-06',
            createdAt: '2026-08-06T10:00:00-06:00',
            status: 'publicado'
        },
        {
            id: 'a2',
            assigneeUserId: 'user-1',
            date: '2026-08-06',
            createdAt: '2026-08-06T11:00:00-06:00',
            status: 'aprobado_internamente'
        },
        {
            id: 'a2',
            contextId: 'manager-1',
            assigneeUserId: 'user-1',
            date: '2026-08-06',
            createdAt: '2026-08-06T11:00:00-06:00',
            status: 'aprobado_internamente'
        }
    ];

    const result = summarizeRolePerformance({
        people,
        tasks,
        collectionName: 'account_tasks',
        closedStatuses: new Set(['aprobado_internamente', 'publicado']),
        now: Date.parse('2026-08-07T06:00:00-06:00')
    });

    assert.equal(result.people[0].created, 2);
    assert.equal(result.people[0].approved, 2);
    assert.equal(result.people[0].inProgress, 0);
});

test('summarizeRolePerformance keeps people without tasks with zero values', () => {
    const people = [
        { id: 'editor-1', name: 'Ana' },
        { id: 'editor-2', name: 'Andres' }
    ];

    const tasks = [
        {
            id: 't1',
            contextId: 'editor-1',
            status: 'publicado',
            date: '2026-08-06',
            createdAt: '2026-08-06T12:00:00-06:00'
        }
    ];

    const result = summarizeRolePerformance({
        people,
        tasks,
        collectionName: 'editing',
        closedStatuses: new Set(['aprobado', 'publicado']),
        now: Date.parse('2026-08-07T06:00:00-06:00')
    });

    const andres = result.people.find((person) => person.id === 'editor-2');
    assert.ok(andres);
    assert.equal(andres.created, 0);
    assert.equal(andres.approved, 0);
    assert.equal(andres.inProgress, 0);
});

test('getTaskCompletionIso matches statusTimestamps when status casing differs', () => {
    assert.equal(
        getTaskCompletionIso({
            status: 'Aprobado',
            statusTimestamps: { aprobado: '2026-08-06T16:00:00-06:00' }
        }),
        '2026-08-06T16:00:00-06:00'
    );
    assert.equal(
        getTaskCompletionIso({
            status: 'publicado',
            statusTimestamps: { Publicado: '2026-08-06T18:00:00-06:00' }
        }),
        '2026-08-06T18:00:00-06:00'
    );
});

test('summarizeRolePerformance only counts same-day completions', () => {
    const people = [
        { id: 'editor-1', name: 'Ana' }
    ];

    const tasks = [
        {
            id: 'same-day',
            contextId: 'editor-1',
            status: 'aprobado',
            createdAt: '2026-08-06T10:00:00-06:00',
            completedAt: '2026-08-06T16:00:00-06:00'
        },
        {
            id: 'next-day',
            contextId: 'editor-1',
            status: 'aprobado',
            createdAt: '2026-08-06T11:00:00-06:00',
            completedAt: '2026-08-07T08:00:00-06:00'
        }
    ];

    const result = summarizeRolePerformance({
        people,
        tasks,
        collectionName: 'editing',
        closedStatuses: new Set(['aprobado', 'publicado']),
        now: Date.parse('2026-08-07T06:00:00-06:00')
    });

    assert.equal(result.people[0].created, 2);
    assert.equal(result.people[0].completed, 1);
    assert.equal(result.people[0].inProgress, 1);
    assert.equal(result.people[0].rate, 50);
});

test('mergeGeneralPerformance combines rooms without duplicating the same email', () => {
    const merged = mergeGeneralPerformance([
        {
            areaLabel: 'Edicion',
            people: [
                { id: 'e1', name: 'Ana', email: 'ana@cluster.ag', created: 3, completed: 2, inProgress: 1, lastActivity: 2, lastActivityLabel: 'tarde' }
            ]
        },
        {
            areaLabel: 'Account',
            people: [
                { id: 'm1', name: 'Ana Vega', email: 'ana@cluster.ag', created: 2, completed: 2, inProgress: 0, lastActivity: 9, lastActivityLabel: 'noche' },
                { id: 'm2', name: 'Luis', email: 'luis@cluster.ag', created: 4, completed: 1, inProgress: 3, lastActivity: 1, lastActivityLabel: 'manana' }
            ]
        }
    ]);

    assert.equal(merged.people.length, 2);
    const ana = merged.people.find((person) => person.email === 'ana@cluster.ag');
    assert.equal(ana.created, 5);
    assert.equal(ana.completed, 4);
    assert.equal(ana.area, 'Edicion / Account');
    assert.equal(merged.totals.created, 9);
    assert.equal(merged.totals.completed, 5);
});

test('summarizeRolePerformance excludes tasks without createdAt', () => {
    const people = [
        { id: 'editor-1', name: 'Ana' }
    ];

    const tasks = [
        {
            id: 't1',
            contextId: 'editor-1',
            status: 'aprobado',
            date: '2026-08-06'
        }
    ];

    const result = summarizeRolePerformance({
        people,
        tasks,
        collectionName: 'editing',
        closedStatuses: new Set(['aprobado', 'publicado']),
        now: Date.parse('2026-08-07T06:00:00-06:00')
    });

    assert.equal(result.people[0].created, 0);
    assert.equal(result.totals.created, 0);
});

test('buildDailyRoleReportPdf writes a PDF with same-day completion columns', async () => {
    const { buildDailyRoleReportPdf } = await import('./daily-reports.js');
    const buffer = await buildDailyRoleReportPdf({
        title: 'Rendimiento diario general',
        periodLabel: '29 sep 2026, 06:00 – 30 sep 2026, 06:00 (Honduras)',
        generatedAt: '2026-09-30T12:00:00.000Z',
        showArea: true,
        people: [
            { name: 'Ana Vega', area: 'Edicion', created: 8, completed: 7, inProgress: 1, rate: 88, lastActivityLabel: '29 sep, 18:40' }
        ],
        totals: { created: 8, completed: 7, inProgress: 1, rate: 88 }
    });
    assert.equal(buffer.slice(0, 4).toString(), '%PDF');
    assert.ok(buffer.length > 400);
});
