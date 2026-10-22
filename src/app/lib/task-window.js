export const TASK_WINDOW_COLLECTIONS = new Set([
    'account_tasks',
    'editing',
    'management_tasks'
]);

export const CLOSED_STATUS_BY_COLLECTION = {
    account_tasks: new Set(['publicado']),
    editing: new Set(['aprobado', 'publicado']),
    management_tasks: new Set(['cerrado'])
};

const pad = (value) => String(value).padStart(2, '0');

const formatDate = (date) => (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
);

export const getBaseTaskWindow = (now = new Date()) => {
    const year = now.getFullYear();
    const month = now.getMonth();
    const from = new Date(year, month - 3, 1);
    const to = new Date(year, month + 2, 0);
    return { dateFrom: formatDate(from), dateTo: formatDate(to) };
};

export const isClosedTaskStatus = (collectionName, status = '') => (
    Boolean(CLOSED_STATUS_BY_COLLECTION[collectionName]?.has(status))
);

export const recordMatchesTaskWindow = (record, collectionName, {
    dateFrom,
    dateTo,
    includeOpenOutside = true
} = {}) => {
    if (!TASK_WINDOW_COLLECTIONS.has(collectionName)) return true;
    const date = String(record?.date || '').slice(0, 10);
    const closed = isClosedTaskStatus(collectionName, record?.status);
    if (date && dateFrom && dateTo && date >= dateFrom && date <= dateTo) return true;
    if (!includeOpenOutside) return false;
    return !closed;
};
