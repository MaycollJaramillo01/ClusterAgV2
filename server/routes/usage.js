import { Router } from 'express';
import { asyncHandler, createHttpError } from '../lib/http.js';
import { hasPermission } from '../lib/permissions.js';
import { listRecords } from '../lib/records.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';
import { recordFeatureVisit } from '../lib/usage-log.js';
import { summarizeTeamUsage, usageWindow } from '../../src/app/utils/usage.js';

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (actor.isActive === false) {
        throw createHttpError(403, 'La cuenta está inactiva.', 'auth/inactive');
    }
    const view = String(req.body?.view || '').trim().slice(0, 40);
    const result = await recordFeatureVisit({ userId: actor.id, view });
    res.json({ ok: true, ...result });
}));

router.get('/', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (!hasPermission(actor, 'view_audit_logs')) {
        throw createHttpError(403, 'No tienes permiso para ver el uso del equipo.', 'auth/insufficient-permission');
    }
    const window = usageWindow(req.query.days);
    const [visits, auditLogs, users] = await Promise.all([
        listRecords({ collectionName: 'usage_days' }),
        listRecords({
            collectionName: 'audit_logs',
            createdFrom: window.createdFrom,
            createdTo: window.createdTo,
            sortBy: 'createdAt',
            sortDirection: 'desc'
        }),
        listRecords({ collectionName: 'users' })
    ]);
    res.json({
        start: window.start,
        end: window.end,
        days: window.days,
        people: summarizeTeamUsage({
            users,
            visits,
            auditLogs,
            start: window.start,
            end: window.end
        })
    });
}));

export default router;
