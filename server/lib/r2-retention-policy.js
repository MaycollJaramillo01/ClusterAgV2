import { DEFAULT_R2_RETENTION_DAYS, isStoredAttachment } from './attachments.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const getR2RetentionMs = (days = DEFAULT_R2_RETENTION_DAYS) => {
    const value = Number(days);
    const safeDays = Number.isFinite(value) && value > 0 ? value : DEFAULT_R2_RETENTION_DAYS;
    return safeDays * MS_PER_DAY;
};

export const attachmentUploadedAt = (attachment, fallbackIso = '') => {
    const stamp = Date.parse(attachment?.uploadedAt || fallbackIso || '');
    return Number.isFinite(stamp) ? stamp : null;
};

export const isExpiredStoredAttachment = (attachment, {
    now = Date.now(),
    retentionMs = getR2RetentionMs(),
    fallbackIso = ''
} = {}) => {
    if (!isStoredAttachment(attachment)) return false;
    const stamp = attachmentUploadedAt(attachment, fallbackIso);
    if (stamp == null) return false;
    return now - stamp >= retentionMs;
};

export const splitExpiredAttachments = (attachments, options = {}) => {
    const expired = [];
    const kept = [];
    for (const attachment of attachments || []) {
        if (isExpiredStoredAttachment(attachment, options)) expired.push(attachment);
        else kept.push(attachment);
    }
    return { expired, kept };
};

export const collectExpiredAttachmentJobs = (records, options = {}) => {
    const jobs = [];
    for (const record of records || []) {
        const attachments = Array.isArray(record.attachments) ? record.attachments : [];
        const { expired, kept } = splitExpiredAttachments(attachments, {
            ...options,
            fallbackIso: record.createdAt || record.created_at || ''
        });
        if (!expired.length) continue;
        jobs.push({
            collectionName: record.collectionName || record.collection_name,
            recordId: record.id || record.recordId || record.record_id,
            expired,
            kept
        });
    }
    return jobs;
};
