import { env } from '../config/env.js';
import { db } from '../db/knex.js';
import { DEFAULT_R2_RETENTION_DAYS, STORED_ATTACHMENT_COLLECTIONS } from './attachments.js';
import { deleteObject, isR2Configured } from './r2.js';
import { upsertRecord } from './records.js';
import { collectExpiredAttachmentJobs, getR2RetentionMs } from './r2-retention-policy.js';

const parsePayload = (raw = '{}') => {
    try {
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
};

export {
    attachmentUploadedAt,
    collectExpiredAttachmentJobs,
    getR2RetentionMs,
    isExpiredStoredAttachment,
    splitExpiredAttachments
} from './r2-retention-policy.js';

export const purgeExpiredStoredAttachments = async ({
    now = Date.now(),
    retentionDays = env.r2.retentionDays,
    deleteObjectFn = deleteObject
} = {}) => {
    if (!isR2Configured()) {
        return {
            skipped: true,
            reason: 'r2-not-configured',
            scanned: 0,
            expired: 0,
            deleted: 0,
            failed: 0,
            updatedRecords: 0
        };
    }

    const retentionMs = getR2RetentionMs(retentionDays);
    const rows = await db('app_records')
        .whereIn('collection_name', [...STORED_ATTACHMENT_COLLECTIONS])
        .select('collection_name', 'record_id', 'payload_json');

    const records = rows.map((row) => ({
        ...parsePayload(row.payload_json),
        collectionName: row.collection_name,
        recordId: row.record_id,
        id: row.record_id
    }));

    const jobs = collectExpiredAttachmentJobs(records, { now, retentionMs });
    let deleted = 0;
    let failed = 0;
    let updatedRecords = 0;
    const expired = jobs.reduce((sum, job) => sum + job.expired.length, 0);

    for (const job of jobs) {
        const remainingExpired = [];
        for (const attachment of job.expired) {
            if (!attachment.key) {
                deleted += 1;
                continue;
            }
            try {
                await deleteObjectFn(attachment.key);
                deleted += 1;
            } catch (error) {
                failed += 1;
                remainingExpired.push(attachment);
                console.warn('[r2-retention] No se pudo borrar', attachment.key, error?.message || error);
            }
        }

        if (remainingExpired.length === job.expired.length) continue;

        await upsertRecord({
            collectionName: job.collectionName,
            recordId: job.recordId,
            payload: { attachments: [...job.kept, ...remainingExpired] }
        });
        updatedRecords += 1;
    }

    return {
        skipped: false,
        retentionDays: Number(retentionDays) > 0 ? Number(retentionDays) : DEFAULT_R2_RETENTION_DAYS,
        scanned: records.length,
        expired,
        deleted,
        failed,
        updatedRecords
    };
};
