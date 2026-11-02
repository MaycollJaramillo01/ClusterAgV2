import { Router } from 'express';
import { db } from '../db/knex.js';
import { asyncHandler, createHttpError } from '../lib/http.js';
import { hasPermission } from '../lib/permissions.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';
import { nowIso } from '../lib/time.js';

const router = Router();
export const CURRENT_WORK_POLICY = Object.freeze({
    key: 'attendance-hours-leave',
    version: '2026-11-02'
});
const DECISIONS = new Set(['accepted', 'rejected']);

router.get('/attendance', asyncHandler(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    const acceptance = await db('policy_acceptances')
        .where({
            policy_key: CURRENT_WORK_POLICY.key,
            policy_version: CURRENT_WORK_POLICY.version,
            user_id: String(user.id)
        })
        .first();
    const canReview = hasPermission(user, 'view_users');
    let responses = [];
    if (canReview) {
        responses = await db('policy_acceptances')
            .where({
                policy_key: CURRENT_WORK_POLICY.key,
                policy_version: CURRENT_WORK_POLICY.version
            })
            .select('user_id', 'user_name', 'user_email', 'user_role', 'decision', 'responded_at')
            .orderBy('user_name', 'asc');
    }
    res.json({
        policy: CURRENT_WORK_POLICY,
        decision: acceptance?.decision || null,
        respondedAt: acceptance?.responded_at || '',
        required: acceptance?.decision !== 'accepted',
        canReview,
        responses: responses.map((row) => ({
            userId: row.user_id,
            name: row.user_name,
            email: row.user_email,
            role: row.user_role,
            decision: row.decision,
            respondedAt: row.responded_at
        }))
    });
}));

router.post('/attendance/decision', asyncHandler(async (req, res) => {
    const user = requireAuthenticatedUser(req);
    const decision = String(req.body?.decision || '').trim();
    if (!DECISIONS.has(decision)) {
        throw createHttpError(400, 'Selecciona aceptar o rechazar la política.', 'policies/invalid-decision');
    }
    const respondedAt = nowIso();
    await db('policy_acceptances')
        .insert({
            policy_key: CURRENT_WORK_POLICY.key,
            policy_version: CURRENT_WORK_POLICY.version,
            user_id: String(user.id),
            user_name: String(user.name || user.email || 'Usuario').trim().slice(0, 180),
            user_email: String(user.email || '').trim().slice(0, 255),
            user_role: String(user.role || 'viewer').slice(0, 80),
            decision,
            responded_at: respondedAt
        })
        .onConflict(['policy_key', 'policy_version', 'user_id'])
        .merge({
            user_name: String(user.name || user.email || 'Usuario').trim().slice(0, 180),
            user_email: String(user.email || '').trim().slice(0, 255),
            user_role: String(user.role || 'viewer').slice(0, 80),
            decision,
            responded_at: respondedAt
        });
    res.json({
        policy: CURRENT_WORK_POLICY,
        decision,
        respondedAt,
        required: decision !== 'accepted'
    });
}));

export default router;
