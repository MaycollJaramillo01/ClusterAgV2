import { db } from '../db/knex.js';
import { createRecordId } from './crypto.js';
import { nowIso } from './time.js';

export const TASK_ACTIVITY_COLLECTIONS = new Set([
    'account_tasks',
    'editing',
    'management_tasks'
]);

const getClient = (trx) => trx || db;

export const recordTaskActivity = async ({
    actor,
    collectionName,
    task,
    action,
    fields = [],
    trx
} = {}) => {
    if (!actor?.id || !TASK_ACTIVITY_COLLECTIONS.has(collectionName) || !task?.id) return;
    await getClient(trx)('task_activity_events').insert({
        id: createRecordId(),
        collection_name: collectionName,
        task_id: String(task.id).slice(0, 120),
        task_title: String(task.title || '(sin título)').trim().slice(0, 180),
        action: String(action || 'updated').slice(0, 30),
        fields_json: JSON.stringify([...new Set(fields.map((field) => String(field).slice(0, 60)))].slice(0, 30)),
        actor_id: String(actor.id).slice(0, 120),
        actor_name: String(actor.name || actor.email || 'Usuario').trim().slice(0, 180),
        created_at: nowIso()
    });
};

export const listTaskActivity = async ({ actorId, limit = 50 } = {}) => {
    const rows = await db('task_activity_events')
        .where({ actor_id: String(actorId || '') })
        .orderBy('created_at', 'desc')
        .limit(Math.min(100, Math.max(1, Number(limit) || 50)));
    return rows.map((row) => {
        let fields = [];
        try {
            fields = JSON.parse(row.fields_json || '[]');
        } catch {
            fields = [];
        }
        return {
            id: row.id,
            collectionName: row.collection_name,
            taskId: row.task_id,
            taskTitle: row.task_title,
            action: row.action,
            fields: Array.isArray(fields) ? fields : [],
            actorId: row.actor_id,
            actorName: row.actor_name,
            createdAt: row.created_at
        };
    });
};
