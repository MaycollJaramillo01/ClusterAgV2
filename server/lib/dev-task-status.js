const MAX_DEV_STATUS_LOG = 200;
const MAX_DEV_STATUS_LABEL = 80;
const MAX_DEV_STATUS_NOTE = 280;

const asText = (value = '') => (typeof value === 'string' ? value.trim() : '');

export const isDevelopmentCategory = (category = '') =>
    asText(category).toLowerCase() === 'desarrollo';

const makeEntryId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const normalizeDevStatusEntry = (entry = {}) => {
    if (!entry || typeof entry !== 'object') return null;
    const label = asText(entry.label || entry.status).slice(0, MAX_DEV_STATUS_LABEL);
    if (!label) return null;
    return {
        id: asText(entry.id).slice(0, 32) || makeEntryId(),
        label,
        note: asText(entry.note).slice(0, MAX_DEV_STATUS_NOTE),
        authorId: asText(entry.authorId).slice(0, 80),
        authorName: asText(entry.authorName).slice(0, 80),
        createdAt: asText(entry.createdAt)
    };
};

export const normalizeDevStatusLog = (value = []) => {
    const source = Array.isArray(value) ? value : [];
    const entries = [];
    const seen = new Set();
    for (const item of source) {
        const entry = normalizeDevStatusEntry(item);
        if (!entry) continue;
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        entries.push(entry);
        if (entries.length >= MAX_DEV_STATUS_LOG) break;
    }
    return entries;
};

export const latestDevStatusLabel = (log = []) => {
    const entries = normalizeDevStatusLog(log);
    return entries[entries.length - 1]?.label || '';
};
