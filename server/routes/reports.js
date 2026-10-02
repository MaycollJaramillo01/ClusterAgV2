import express from 'express';
import { db } from '../db/knex.js';
import { asyncHandler, createHttpError } from '../lib/http.js';
import { hasPermission } from '../lib/permissions.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';
import { buildDailyPerformanceReports } from '../lib/daily-reports.js';
import { buildWeeklyModuleReports } from '../lib/weekly-module-reports.js';

const router = express.Router();

const parseUserPayload = (value) => {
    try {
        return typeof value === 'string' ? JSON.parse(value) : (value || {});
    } catch {
        return {};
    }
};

const sendPdfAttachment = (res, pdf, filename) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
};

router.get('/rendimiento-editores', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (!hasPermission(actor, 'view_audit_logs')) {
        throw createHttpError(403, 'No tienes permisos para ver este reporte.', 'auth/insufficient-permission');
    }

    const rows = await db('auth_sessions as s')
        .join('app_records as u', 'u.record_id', 's.user_record_id')
        .where('u.collection_name', 'users')
        .select('s.user_record_id', 'u.payload_json')
        .max({ last_seen_at: 's.last_seen_at' })
        .groupBy('s.user_record_id', 'u.payload_json');

    const data = rows.map((row) => {
        const user = parseUserPayload(row.payload_json);
        return {
            user_id: row.user_record_id,
            email: user.email || '',
            nombre: user.name || '',
            ultimo_login: row.last_seen_at || null
        };
    });

    res.json({ success: true, data });
}));

router.get('/rendimiento-diario.pdf', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (!hasPermission(actor, 'view_dashboard')) {
        throw createHttpError(403, 'No tienes permisos para ver este reporte.', 'auth/insufficient-permission');
    }

    const scope = String(req.query.scope || 'general').trim().toLowerCase();
    const bundle = await buildDailyPerformanceReports();
    const pdf = scope === 'editors'
        ? bundle.pdfs.editors
        : scope === 'managers'
            ? bundle.pdfs.communityManagers
            : bundle.pdfs.general;
    const filename = `rendimiento-${scope === 'editors' || scope === 'managers' ? scope : 'general'}-${bundle.window.labelDayKey}.pdf`;
    sendPdfAttachment(res, pdf, filename);
}));

router.get('/rendimiento-semanal.pdf', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (!hasPermission(actor, 'view_dashboard')) {
        throw createHttpError(403, 'No tienes permisos para ver este reporte.', 'auth/insufficient-permission');
    }

    const scope = String(req.query.scope || 'podcast').trim().toLowerCase();
    const bundle = await buildWeeklyModuleReports();
    const isProduction = scope === 'production';
    const pdf = isProduction ? bundle.pdfs.production : bundle.pdfs.podcast;
    const filename = `resumen-${isProduction ? 'produccion' : 'podcast'}.pdf`;
    sendPdfAttachment(res, pdf, filename);
}));

export default router;
