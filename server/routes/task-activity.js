import { Router } from 'express';
import { asyncHandler, createHttpError } from '../lib/http.js';
import { getCollectionPermission, hasPermission } from '../lib/permissions.js';
import { getRecord } from '../lib/records.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';
import { listTaskActivity, recordTaskActivity, TASK_ACTIVITY_COLLECTIONS } from '../lib/task-activity.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    if (!hasPermission(actor, 'view_dashboard')) {
        throw createHttpError(403, 'No tienes permiso para consultar la actividad.', 'auth/insufficient-permission');
    }
    const actorId = String(req.query.actorId || '').trim();
    if (!actorId || actorId.length > 120) {
        throw createHttpError(400, 'El usuario de actividad no es válido.', 'activity/invalid-user');
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    res.json({ events: await listTaskActivity({ actorId, limit }) });
}));

router.post('/open', asyncHandler(async (req, res) => {
    const actor = requireAuthenticatedUser(req);
    const collectionName = String(req.body?.collectionName || '').trim();
    const taskId = String(req.body?.taskId || '').trim();
    const permission = TASK_ACTIVITY_COLLECTIONS.has(collectionName)
        ? getCollectionPermission(collectionName, 'read')
        : null;
    if (!permission || !hasPermission(actor, permission)) {
        throw createHttpError(403, 'No tienes acceso a esta tarea.', 'auth/insufficient-permission');
    }
    const task = taskId ? await getRecord({ collectionName, recordId: taskId }) : null;
    if (!task) throw createHttpError(404, 'La tarea no existe.', 'document/not-found');
    await recordTaskActivity({ actor, collectionName, task, action: 'opened' });
    res.status(201).json({ ok: true });
}));

export default router;
