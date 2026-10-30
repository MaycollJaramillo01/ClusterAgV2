import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComplianceEmail, buildManagementTaskEmail, shouldRequireSmtp } from './email.js';

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

test('reminder email names the assignee for supervisors and uses the configured interval', () => {
    const mail = buildManagementTaskEmail({
        variant: 'overdue-nag',
        overdueHours: 8,
        nagIntervalHours: 6,
        recipientRole: 'supervisor',
        recipientName: 'Gestion',
        assigneeName: 'Luis <script>',
        taskTitle: 'Landing',
        doneLabel: 'Cerrado'
    });
    assert.match(mail.html, /del equipo de <strong>Luis &lt;script&gt;<\/strong>/);
    assert.match(mail.html, /cada 6 h/);
});

test('compliance email: editor daily goal uses the agreed copy and escalates to supervisors', () => {
    const own = buildComplianceEmail({
        kind: 'editor-daily',
        recipientRole: 'self',
        recipientName: 'Edi',
        subjectName: 'Edi',
        metrics: { day: '2026-10-27', completed: 3, target: 5, penalty: 8 }
    });
    assert.match(own.subject, /No cumpliste con la meta diaria/);
    assert.match(own.html, /no cumpliste con la meta diaria por lo cual eso está afectando tu rendimiento en el sistema\./i);
    assert.match(own.html, /3 de 5 piezas nuevas/);
    assert.match(own.html, /-8 pts/);

    const boss = buildComplianceEmail({
        kind: 'editor-daily',
        recipientRole: 'supervisor',
        recipientName: 'Gestion',
        subjectName: 'Edi',
        metrics: { day: '2026-10-27', completed: 3, target: 5, penalty: 8 }
    });
    assert.match(boss.subject, /Edi no cumplió la meta diaria/);
    assert.match(boss.html, /<strong>Edi<\/strong> \(Editor\)/);
});

test('compliance email: Account Manager pace shows elapsed vs progress percentages', () => {
    const own = buildComplianceEmail({
        kind: 'account-pace',
        recipientRole: 'self',
        recipientName: 'Ana',
        subjectName: 'Ana',
        nagIntervalHours: 6,
        metrics: { elapsedPercent: 35, progressPercent: 30, completed: 3, assigned: 10, penalty: 5 }
    });
    assert.match(own.html, /<strong>35%<\/strong> de tu semana laborable/);
    assert.match(own.html, /<strong>30%<\/strong> de tus publicaciones/);
    assert.match(own.html, /cada 6 h/);
    assert.match(own.html, /3 de 10 publicaciones/);

    const boss = buildComplianceEmail({
        kind: 'account-pace',
        recipientRole: 'supervisor',
        subjectName: 'Ana',
        metrics: { elapsedPercent: 35, progressPercent: 30, completed: 3, assigned: 10, penalty: 5 }
    });
    assert.match(boss.html, /\(Account Manager\)/);
});
