import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComplianceProfiles, planComplianceNotices } from './compliance-events.js';

const OPTIONS = { nagIntervalHours: 6, windowStartHour: 7, windowEndHour: 19 };
const WEDNESDAY_11AM = Date.parse('2026-10-28T11:00:00-06:00');

const users = [
    { id: 'u-admin', name: 'Admin', email: 'admin@cluster.ag', role: 'super_admin' },
    { id: 'u-mgmt', name: 'Gestion', email: 'mgmt@cluster.ag', role: 'management' },
    { id: 'u-am1', name: 'Ana AM', email: 'ana@cluster.ag', role: 'manager', linkedManagerId: 'm1' },
    { id: 'u-am2', name: 'Otra AM', email: 'otra@cluster.ag', role: 'manager', linkedManagerId: 'm2' },
    { id: 'u-ed', name: 'Edi', email: 'edi@cluster.ag', role: 'editor', linkedEditorId: 'e1' }
];
const clients = [{ id: 'c1', name: 'Cliente 1', managerId: 'm1' }];

// Ana: 2 de 10 publicaciones (20%) con ~52% de la semana laboral transcurrida.
const accountTasks = Array.from({ length: 10 }, (_, index) => ({
    id: `acc-${index}`,
    clientId: 'c1',
    contextId: 'm1',
    date: '2026-10-30',
    status: index < 2 ? 'publicado' : 'por_disenar',
    completedAt: index < 2 ? '2026-10-27T10:00:00-06:00' : undefined
}));
// Edi: el martes solo entrego 2 de 5 piezas nuevas.
const editingTasks = Array.from({ length: 5 }, (_, index) => ({
    id: `edit-${index}`,
    clientId: 'c1',
    contextId: 'e1',
    date: '2026-10-27',
    status: index < 2 ? 'revision_interna' : 'editar',
    editorCompletedAt: index < 2 ? '2026-10-27T15:00:00-06:00' : undefined
}));

const plan = (overrides = {}) => planComplianceNotices({
    users,
    clients,
    accountTasks,
    editingTasks,
    nowMs: WEDNESDAY_11AM,
    ...OPTIONS,
    ...overrides
});
const emails = (notice) => notice.recipients.map((recipient) => recipient.email).sort();

test('buildComplianceProfiles incluye usuarios y registros de directorio sin usuario, sin duplicar', () => {
    const profiles = buildComplianceProfiles({
        users,
        managers: [
            { id: 'm1', name: 'Ana AM', email: 'ana@cluster.ag' },
            { id: 'm9', name: 'Sin usuario', email: 'solo@cluster.ag' },
            { id: 'm8', name: 'Inactivo', email: 'off@cluster.ag', isActive: false }
        ],
        editors: [{ id: 'e1', name: 'Edi', email: 'edi@cluster.ag' }]
    });
    assert.deepEqual(profiles.map((item) => item.email).sort(), [
        'ana@cluster.ag', 'edi@cluster.ag', 'otra@cluster.ag', 'solo@cluster.ag'
    ]);
    assert.equal(profiles.find((item) => item.email === 'solo@cluster.ag').role, 'manager');
});

test('Account Manager por debajo del ritmo semanal: aviso propio y aviso diario a sus superiores', () => {
    const result = plan();
    const self = result.notices.find((item) => item.id === 'account-pace:u-am1:2026-10-26');
    assert.ok(self);
    assert.equal(self.audience, 'self');
    assert.deepEqual(emails(self), ['ana@cluster.ag']);
    assert.equal(self.metrics.progressPercent, 20);
    assert.ok(self.metrics.elapsedPercent > 20);
    assert.ok(self.metrics.penalty > 0);

    const supervisors = result.notices.find((item) => item.id === 'account-pace-supervisors:u-am1:2026-10-28');
    assert.ok(supervisors);
    assert.deepEqual(emails(supervisors), ['admin@cluster.ag', 'mgmt@cluster.ag']);
    assert.ok(supervisors.recipients.every((recipient) => recipient.role === 'supervisor'));
});

test('el editor que no llego a la meta del dia habil anterior avisa a el, a superiores y al Account Manager del cliente', () => {
    const notice = plan().notices.find((item) => item.kind === 'editor-daily');
    assert.ok(notice);
    assert.equal(notice.id, 'editor-daily:u-ed:2026-10-28');
    assert.equal(notice.metrics.day, '2026-10-27');
    assert.equal(notice.metrics.completed, 2);
    assert.equal(notice.metrics.target, 5);
    assert.equal(notice.metrics.penalty, 12);
    // La otra Account Manager no maneja el cliente, por lo que no recibe el aviso.
    assert.deepEqual(emails(notice), [
        'admin@cluster.ag', 'ana@cluster.ag', 'edi@cluster.ag', 'mgmt@cluster.ag'
    ]);
    assert.equal(notice.recipients.find((recipient) => recipient.email === 'edi@cluster.ag').role, 'self');
});

test('no repite avisos antes del intervalo y la meta diaria sale una sola vez al dia', () => {
    const sentAt = (hoursAgo) => new Date(WEDNESDAY_11AM - (hoursAgo * 3600 * 1000)).toISOString();
    const notices = [
        { id: 'account-pace:u-am1:2026-10-26', lastSentAt: sentAt(2) },
        { id: 'account-pace-supervisors:u-am1:2026-10-28', lastSentAt: sentAt(2) },
        { id: 'editor-daily:u-ed:2026-10-28', lastSentAt: sentAt(4) }
    ];
    assert.deepEqual(plan({ notices }).notices, []);

    // Pasadas 6 h el Account Manager vuelve a recibir su aviso; sus superiores y el editor no.
    const later = plan({
        notices: notices.map((item) => ({ ...item, lastSentAt: sentAt(6) })),
        nowMs: WEDNESDAY_11AM
    }).notices.map((item) => item.id);
    assert.deepEqual(later, ['account-pace:u-am1:2026-10-26']);
});

test('no se envia fines de semana ni fuera del horario laboral', () => {
    const saturday = plan({ nowMs: Date.parse('2026-10-31T11:00:00-06:00') });
    assert.equal(saturday.skipped, 'weekend');
    assert.deepEqual(saturday.notices, []);

    const night = plan({ nowMs: Date.parse('2026-10-28T20:00:00-06:00') });
    assert.equal(night.skipped, 'outside-window');
    assert.deepEqual(night.notices, []);
});

test('sin incumplimientos no se genera ningun aviso', () => {
    const onPace = accountTasks.map((task, index) => ({
        ...task,
        status: index < 8 ? 'publicado' : 'por_disenar',
        completedAt: index < 8 ? '2026-10-27T10:00:00-06:00' : undefined
    }));
    const done = editingTasks.map((task) => ({
        ...task,
        status: 'revision_interna',
        editorCompletedAt: '2026-10-27T15:00:00-06:00'
    }));
    assert.deepEqual(plan({ accountTasks: onPace, editingTasks: done }).notices, []);
});
