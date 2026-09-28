export const CLIENT_PRIORITY_FLAGS = [
    {
        id: 'critica',
        label: 'Crítica',
        rank: 0,
        notify: true,
        chip: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40',
        dot: 'bg-red-500'
    },
    {
        id: 'alta',
        label: 'Alta',
        rank: 1,
        notify: true,
        chip: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/40',
        dot: 'bg-orange-500'
    },
    {
        id: 'media',
        label: 'Media',
        rank: 2,
        notify: false,
        chip: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40',
        dot: 'bg-amber-400'
    },
    {
        id: 'baja',
        label: 'Baja',
        rank: 3,
        notify: false,
        chip: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/40',
        dot: 'bg-sky-500'
    },
    {
        id: 'ninguna',
        label: 'Sin flag',
        rank: 4,
        notify: false,
        chip: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
        dot: 'bg-slate-400'
    }
];

export const DEFAULT_CLIENT_PRIORITY = 'ninguna';

const FLAG_BY_ID = new Map(CLIENT_PRIORITY_FLAGS.map((flag) => [flag.id, flag]));

export const normalizeClientPriority = (value) => (
    FLAG_BY_ID.has(String(value || '')) ? String(value) : DEFAULT_CLIENT_PRIORITY
);

export const getClientPriority = (client) => (
    FLAG_BY_ID.get(normalizeClientPriority(client?.priorityFlag || client?.priority))
    || FLAG_BY_ID.get(DEFAULT_CLIENT_PRIORITY)
);

export const compareClientsByPriority = (left, right) => {
    const rankDiff = getClientPriority(left).rank - getClientPriority(right).rank;
    if (rankDiff !== 0) return rankDiff;
    return String(left?.name || '').localeCompare(String(right?.name || ''), 'es', { sensitivity: 'base' });
};

export const groupClientsByPriority = (clients = []) => (
    CLIENT_PRIORITY_FLAGS
        .map((flag) => ({
            flag,
            clients: clients.filter((client) => getClientPriority(client).id === flag.id)
        }))
        .filter((group) => group.clients.length > 0)
);

export const shouldNotifyClientPriority = (value) => Boolean(getClientPriority({ priorityFlag: value }).notify);
