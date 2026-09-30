import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManagementTaskEmail, shouldRequireSmtp } from './email.js';

test('SMTP is required in production and for report attachments', () => {
    assert.equal(shouldRequireSmtp({ isProduction: false, hasAttachments: false }), false);
    assert.equal(shouldRequireSmtp({ isProduction: true, hasAttachments: false }), true);
    assert.equal(shouldRequireSmtp({ isProduction: false, hasAttachments: true }), true);
});

test('reminder email copy changes for admin, assigner and assignee', () => {
    const assigneeMail = buildManagementTaskEmail({
        variant: 'upcoming',
        label: '24 horas',
        recipientRole: 'assignee',
        recipientName: 'Luis',
        assignedByName: 'Ana',
        taskTitle: 'Landing'
    });
    assert.match(assigneeMail.subject, /proxima a vencer/);
    assert.match(assigneeMail.html, /tenes una tarea/);

    const assignerMail = buildManagementTaskEmail({
        variant: 'overdue',
        recipientRole: 'assigner',
        recipientName: 'Ana',
        taskTitle: 'Landing'
    });
    assert.match(assignerMail.html, /que asignaste/);

    const adminMail = buildManagementTaskEmail({
        variant: 'overdue-nag',
        overdueHours: 26,
        recipientRole: 'admin',
        recipientName: 'Admin',
        taskTitle: 'Landing',
        doneLabel: 'Cerrado'
    });
    assert.match(adminMail.html, /del equipo/);
    assert.match(adminMail.html, /cada 24 h/);
});
