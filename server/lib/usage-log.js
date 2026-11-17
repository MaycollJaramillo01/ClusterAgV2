import { createHash } from 'node:crypto';
import { getRecord, upsertRecord } from './records.js';
import { nowIso } from './time.js';
import { applyUsageVisit, featureForView } from '../../src/app/utils/usage.js';
import { getHondurasDateString } from '../../src/app/utils/date.js';

export const usageDayId = (userId, date) => {
    const digest = createHash('sha256').update(`${userId}|${date}`).digest('hex').slice(0, 24);
    return `usage_${date}_${digest}`;
};

export const recordFeatureVisit = async ({ userId, view, now = new Date() } = {}) => {
    const featureId = featureForView(view);
    const actorId = String(userId || '').trim();
    if (!featureId || !actorId) return { recorded: false };
    const date = getHondurasDateString(now);
    const recordId = usageDayId(actorId, date);
    const existing = await getRecord({ collectionName: 'usage_days', recordId });
    const next = applyUsageVisit(existing || {}, featureId, now.getTime());
    if (!next) return { recorded: false, featureId, date };
    await upsertRecord({
        collectionName: 'usage_days',
        recordId,
        merge: true,
        payload: {
            userId: actorId,
            date,
            visits: next.visits,
            lastFeatureAt: next.lastFeatureAt,
            lastAt: nowIso()
        }
    });
    return { recorded: true, featureId, date };
};
