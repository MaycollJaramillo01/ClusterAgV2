import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { createHttpError } from './http.js';

const createAttachmentBuffer = (buffer, filename, contentType = 'application/pdf') => ({
    filename,
    content: buffer,
    contentType
});

let transporter = null;

export const hasSmtpConfig = () => Boolean(env.smtp.host && env.smtp.user && env.smtp.password);

export const shouldRequireSmtp = ({
    isProduction = env.isProduction,
    hasAttachments = false
} = {}) => Boolean(isProduction || hasAttachments);

const getTransporter = () => {
    if (!hasSmtpConfig()) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: env.smtp.host,
            port: env.smtp.port,
            secure: env.smtp.secure,
            auth: {
                user: env.smtp.user,
                pass: env.smtp.password
            }
        });
    }
    return transporter;
};

export const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const sendEmail = async ({
    to,
    subject,
    html,
    attachments = [],
    logLabel = 'email'
}) => {
    const mailer = getTransporter();
    const mustDeliver = shouldRequireSmtp({ hasAttachments: attachments.length > 0 });
    if (!mailer) {
        if (mustDeliver) {
            throw createHttpError(503, 'SMTP no configurado.', 'email/not-configured');
        }
        console.info(`[${logLabel}:${Array.isArray(to) ? to.join(', ') : to}] ${subject}`);
        return { mode: 'console' };
    }

    try {
        await mailer.sendMail({
            from: env.smtp.from,
            to: Array.isArray(to) ? to.filter(Boolean).join(', ') : to,
            subject,
            html,
            ...(attachments.length > 0 ? { attachments } : {})
        });
    } catch (error) {
        throw createHttpError(
            502,
            `No se pudo enviar el correo: ${error?.message || 'error SMTP'}.`,
            'email/send-failed'
        );
    }

    return { mode: 'smtp' };
};

export const buildManagementTaskEmail = ({
    variant,
    label,
    overdueHours,
    nagIntervalHours = 24,
    taskTypeLabel = 'tarea',
    roomLabel = 'Cluster OS',
    doneLabel = 'completada',
    assigneeName,
    assignedByName,
    recipientName,
    recipientRole = 'assignee',
    taskTitle,
    taskNotes,
    clientName,
    dueHuman,
    taskUrl
}) => {
    const safeTitle = escapeHtml(taskTitle);
    const greetingSource = recipientName || (recipientRole === 'assignee' ? assigneeName : '') || '';
    const safeName = escapeHtml(greetingSource);
    const safeAssignedBy = escapeHtml(assignedByName || '');
    const safeAssignee = escapeHtml(assigneeName || '');
    const safeClient = clientName ? escapeHtml(clientName) : '';
    const safeNotes = taskNotes ? escapeHtml(taskNotes) : '';
    const safeDue = escapeHtml(dueHuman || '');
    const hello = `Hola${safeName ? ` ${safeName}` : ''}`;
    const taskPhrase = escapeHtml(taskTypeLabel);
    const assignedByBit = safeAssignedBy ? ` asignada por <strong>${safeAssignedBy}</strong>` : '';
    const link = taskUrl
        ? `<p style="margin:16px 0;"><a href="${taskUrl}" style="background:#7c3aed;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;">Abrir en Cluster OS</a></p>`
        : '';

    const roleLead = (upcomingText) => {
        if (recipientRole === 'assigner') {
            return `${hello}, una ${taskPhrase} que asignaste ${upcomingText}`;
        }
        if (recipientRole === 'admin' || recipientRole === 'supervisor') {
            const ofAssignee = safeAssignee ? ` de <strong>${safeAssignee}</strong>` : '';
            return `${hello}, una ${taskPhrase} del equipo${ofAssignee}${assignedByBit} ${upcomingText}`;
        }
        return `${hello}, tenes una ${taskPhrase}${assignedByBit} ${upcomingText}`;
    };

    let subject = '';
    let heading = '';
    let lead = '';
    let accent = '#7c3aed';

    if (variant === 'upcoming') {
        subject = `[Cluster OS] Tarea proxima a vencer (${label}): ${taskTitle}`;
        heading = `Tarea por vencer en ${escapeHtml(label)}`;
        lead = roleLead(`vence en <strong>${escapeHtml(label)}</strong>.`);
        accent = '#f59e0b';
    } else if (variant === 'upcoming-nag') {
        subject = `[Cluster OS] Tarea proxima: ${taskTitle}`;
        heading = 'Recordatorio: sigue proxima a vencer';
        lead = `${roleLead(`sigue abierta y vence en <strong>${escapeHtml(label || 'unas horas')}</strong>.`)} Te seguiremos avisando hasta que se complete o venza.`;
        accent = '#d97706';
    } else if (variant === 'overdue') {
        subject = `[Cluster OS] Tarea VENCIDA: ${taskTitle}`;
        heading = 'Tarea vencida';
        lead = roleLead('ya paso su fecha limite y sigue pendiente.');
        accent = '#dc2626';
    } else {
        subject = `[Cluster OS] Tarea vencida hace ${overdueHours || 0}h: ${taskTitle}`;
        heading = `Recordatorio: sigue vencida hace ${overdueHours || 0}h`;
        lead = `${roleLead('todavia sigue pendiente.')} Te enviaremos un aviso cada ${Number(nagIntervalHours) || 24} h hasta que se marque como ${escapeHtml(doneLabel)}.`;
        accent = '#b91c1c';
    }

    const rows = [
        ['Tarea', `<strong>${safeTitle}</strong>`],
        ['Fecha limite', safeDue],
        ...(safeAssignee ? [['Asignada a', safeAssignee]] : []),
        ...(safeAssignedBy ? [['Asignada por', safeAssignedBy]] : []),
        ...(safeClient ? [['Cliente', safeClient]] : []),
        ...(safeNotes ? [['Notas', safeNotes.replace(/\n/g, '<br>')]] : [])
    ];

    const tableRows = rows.map(([k, v]) => (
        `<tr><td style="padding:6px 12px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">${k}</td>`
        + `<td style="padding:6px 12px;color:#0f172a;font-size:14px;">${v}</td></tr>`
    )).join('');

    const html = `
        <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
            <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
                <div style="background:${accent};color:#fff;padding:20px 24px;">
                    <p style="margin:0;font-size:12px;letter-spacing:.15em;text-transform:uppercase;opacity:.85;">${escapeHtml(roomLabel)}</p>
                    <h2 style="margin:8px 0 0;font-size:22px;">${heading}</h2>
                </div>
                <div style="padding:24px;">
                    <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">${lead}</p>
                    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;">${tableRows}</table>
                    ${link}
                    <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">Este correo fue generado automaticamente. Si ya completaste la tarea, abrila en Cluster OS y movela a <em>${escapeHtml(doneLabel)}</em> para dejar de recibir recordatorios.</p>
                </div>
            </div>
        </div>
    `;

    return { subject, html };
};

export const sendManagementTaskReminderEmail = async (context = {}) => {
    const { subject, html } = buildManagementTaskEmail(context);
    return sendEmail({
        to: context.to,
        subject,
        html,
        logLabel: 'management-reminder'
    });
};

const COMPLIANCE_SUBJECT_ROLE_LABEL = {
    'editor-daily': 'Editor',
    'account-pace': 'Account Manager'
};

export const buildComplianceEmail = ({
    kind,
    recipientRole = 'self',
    recipientName = '',
    subjectName = '',
    metrics = {},
    nagIntervalHours = 6,
    appUrl = ''
}) => {
    const isSelf = recipientRole === 'self';
    const roleLabel = COMPLIANCE_SUBJECT_ROLE_LABEL[kind] || 'Equipo';
    const safeSubject = escapeHtml(subjectName || 'Un integrante del equipo');
    const hello = `Hola${recipientName ? ` ${escapeHtml(recipientName)}` : ''}`;
    const penalty = Math.max(0, Math.round(Number(metrics.penalty) || 0));
    const penaltyRow = penalty > 0
        ? [['Penalización en rendimiento', `<strong>-${penalty} pts</strong>`]]
        : [];

    let subject = '';
    let heading = '';
    let lead = '';
    let rows = [];

    if (kind === 'editor-daily') {
        const completed = Number(metrics.completed) || 0;
        const target = Number(metrics.target) || 0;
        const meta = `${completed} de ${target} piezas nuevas`;
        if (isSelf) {
            subject = '[Cluster OS] No cumpliste con la meta diaria';
            heading = 'Meta diaria no cumplida';
            lead = `${hello}, no cumpliste con la meta diaria por lo cual eso está afectando tu rendimiento en el sistema.`;
        } else {
            subject = `[Cluster OS] ${subjectName || 'Un editor'} no cumplió la meta diaria`;
            heading = 'Meta diaria no cumplida en tu equipo';
            lead = `${hello}, <strong>${safeSubject}</strong> (${roleLabel}) no cumplió con la meta diaria, lo que está afectando su rendimiento en el sistema.`;
        }
        rows = [
            ['Día evaluado', escapeHtml(metrics.day || '')],
            ['Completadas', escapeHtml(meta)],
            ...penaltyRow
        ];
    } else {
        const elapsed = Number(metrics.elapsedPercent) || 0;
        const progress = Number(metrics.progressPercent) || 0;
        const detail = `${Number(metrics.completed) || 0} de ${Number(metrics.assigned) || 0} publicaciones`;
        if (isSelf) {
            subject = '[Cluster OS] Tu ritmo semanal está por debajo de lo esperado';
            heading = 'Ritmo semanal por debajo de lo esperado';
            lead = `${hello}, ha transcurrido el <strong>${elapsed}%</strong> de tu semana laborable y solo llevas el <strong>${progress}%</strong> de tus publicaciones. Esto está afectando tu rendimiento en el sistema. Te seguiremos avisando cada ${Number(nagIntervalHours) || 6} h mientras sigas por debajo.`;
        } else {
            subject = `[Cluster OS] ${subjectName || 'Un Account Manager'} va por debajo del ritmo semanal`;
            heading = 'Ritmo semanal por debajo de lo esperado en tu equipo';
            lead = `${hello}, de la semana laborable ha transcurrido el <strong>${elapsed}%</strong> y <strong>${safeSubject}</strong> (${roleLabel}) solo lleva el <strong>${progress}%</strong> de sus publicaciones.`;
        }
        rows = [
            ['Semana transcurrida', `${elapsed}%`],
            ['Avance de publicaciones', `${progress}%`],
            ['Publicadas', escapeHtml(detail)],
            ...penaltyRow
        ];
    }

    const tableRows = rows.map(([key, value]) => (
        `<tr><td style="padding:6px 12px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.08em;">${key}</td>`
        + `<td style="padding:6px 12px;color:#0f172a;font-size:14px;">${value}</td></tr>`
    )).join('');
    const link = appUrl
        ? `<p style="margin:16px 0;"><a href="${escapeHtml(appUrl)}" style="background:#dc2626;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;">Abrir Cluster OS</a></p>`
        : '';

    const html = `
        <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
            <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #fecaca;">
                <div style="background:#dc2626;color:#fff;padding:20px 24px;">
                    <p style="margin:0;font-size:12px;letter-spacing:.15em;text-transform:uppercase;opacity:.85;">Cluster OS - Alerta de cumplimiento</p>
                    <h2 style="margin:8px 0 0;font-size:22px;">${escapeHtml(heading)}</h2>
                </div>
                <div style="padding:24px;">
                    <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;">${lead}</p>
                    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;">${tableRows}</table>
                    ${link}
                    <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">Este correo fue generado automaticamente por Cluster OS.</p>
                </div>
            </div>
        </div>
    `;

    return { subject, html };
};

export const sendComplianceEmail = async (context = {}) => {
    const { subject, html } = buildComplianceEmail(context);
    return sendEmail({
        to: context.to,
        subject,
        html,
        logLabel: 'compliance-alert'
    });
};

export const sendDailyReportEmail = async ({
    to,
    subject,
    generalPdf,
    editorPdf,
    accountPdf,
    generatedAt,
    periodLabel = ''
}) => {
    const periodLine = periodLabel
        ? `<p style="margin:0 0 12px;color:#475569;">Periodo: <strong>${escapeHtml(periodLabel)}</strong></p>`
        : '';
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#f8fafc;">
            <div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
                <h2 style="margin:0 0 8px;color:#0f172a;">Rendimiento diario del equipo</h2>
                ${periodLine}
                <p style="margin:0 0 16px;color:#475569;">Se adjuntan PDFs con las tareas <strong>creadas y completadas el mismo dia</strong> (ventana 6:00 AM a 6:00 AM Honduras): informe general, editores y community managers. Generado el ${escapeHtml(generatedAt)}.</p>
                <p style="margin:0;color:#64748b;font-size:13px;">Este correo fue generado automaticamente por Cluster OS.</p>
            </div>
        </div>
    `;

    return sendEmail({
        to,
        subject,
        html,
        attachments: [
            ...(generalPdf ? [createAttachmentBuffer(generalPdf, 'rendimiento-general.pdf')] : []),
            ...(editorPdf ? [createAttachmentBuffer(editorPdf, 'resumen-editores.pdf')] : []),
            ...(accountPdf ? [createAttachmentBuffer(accountPdf, 'resumen-community-managers.pdf')] : [])
        ],
        logLabel: 'daily-report'
    });
};

export const sendWeeklyModuleReportEmail = async ({
    to,
    subject,
    podcastPdf,
    productionPdf,
    generatedAt,
    periodLabel = ''
}) => {
    const periodLine = periodLabel
        ? `<p style="margin:0 0 12px;color:#475569;">Periodo: <strong>${escapeHtml(periodLabel)}</strong></p>`
        : '';
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#f8fafc;">
            <div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #e2e8f0;">
                <h2 style="margin:0 0 8px;color:#0f172a;">Resumen semanal de Podcast y Producción</h2>
                ${periodLine}
                <p style="margin:0 0 16px;color:#475569;">Se adjuntan dos PDFs con las tareas pasadas a <strong>listo</strong> entre lunes 6:00 AM y sábado 12:00 mediodía Honduras, generado el ${escapeHtml(generatedAt)}.</p>
                <p style="margin:0;color:#64748b;font-size:13px;">Este correo fue generado automáticamente por Cluster OS.</p>
            </div>
        </div>
    `;

    return sendEmail({
        to,
        subject,
        html,
        attachments: [
            ...(podcastPdf ? [createAttachmentBuffer(podcastPdf, 'resumen-podcast.pdf')] : []),
            ...(productionPdf ? [createAttachmentBuffer(productionPdf, 'resumen-produccion.pdf')] : [])
        ],
        logLabel: 'weekly-module-report'
    });
};
