import { apiFetch } from './backend-api.js?v=20260525-local-api';
import {
    TASK_WINDOW_COLLECTIONS,
    getBaseTaskWindow,
    recordMatchesTaskWindow
} from './task-window.js';

const registry = new Map();
const DEFAULT_POLL_MS = 120000;
const ROOM_POLL_MS = 30000;
const CHAT_POLL_MS = 10000;
const IDLE_AFTER_MS = 240000;
const TASK_COLLECTIONS = TASK_WINDOW_COLLECTIONS;
const STATIC_COLLECTIONS = new Set(['clients', 'events', 'managers', 'editors', 'users', 'client_chats', 'chat_reads', 'chat_mutes', 'chat_hidden', 'chat_reactions', 'chat_pins', 'chat_stickers', 'team_groups']);
const LIVE_COLLECTION_BY_VIEW = {
    'account-room': ['account_tasks'],
    editions: ['editing'],
    'management-room': ['management_tasks'],
    production: ['events', 'account_tasks', 'editing'],
    podcast: ['events', 'account_tasks', 'editing'],
    'control-center': ['audit_logs'],
    chat: ['client_chats'],
    reports: ['account_tasks', 'editing', 'management_tasks', 'users', 'managers', 'editors'],
    performance: ['account_tasks', 'editing', 'management_tasks', 'users', 'managers', 'editors']
};

const syncCursors = new Map();
let latestCursorPromise = null;
let syncTimerId = null;
let syncInFlight = false;
let lastActivityAt = Date.now();
let lastFocusRefreshAt = 0;

const createDocSnapshot = (record) => ({
    id: record.id,
    data: () => ({ ...record })
});

const createQuerySnapshot = (records = []) => ({
    docs: records.map(createDocSnapshot),
    size: records.length
});

const getCollectionName = (ref) => {
    if (ref?.__kind === 'query') return getCollectionName(ref.baseRef);
    const segments = Array.isArray(ref?.segments) ? ref.segments : [];
    if (segments.length === 0) return '';
    return segments[ref.__kind === 'doc' ? segments.length - 2 : segments.length - 1] || '';
};

const getRecordId = (ref) => {
    const segments = Array.isArray(ref?.segments) ? ref.segments : [];
    return ref?.__kind === 'doc' ? segments[segments.length - 1] || '' : '';
};

const buildQueryOptions = (ref) => {
    const options = {
        orderBy: 'updatedAt',
        orderDir: 'asc',
        limit: null
    };

    if (ref?.__kind !== 'query') return options;

    ref.constraints.forEach((constraint) => {
        if (constraint?.type === 'orderBy') {
            options.orderBy = constraint.field;
            options.orderDir = constraint.direction || 'asc';
        }
        if (constraint?.type === 'limit') {
            options.limit = constraint.count;
        }
    });

    return options;
};

const isPollingAllowed = ({ visibilityState = 'visible', lastActivity = 0, now = Date.now(), idleAfter = IDLE_AFTER_MS }) => (
    visibilityState === 'visible' && now - lastActivity < idleAfter
);

const recordMatchesRef = (record, ref) => {
    const collectionName = getCollectionName(ref);
    if (!TASK_COLLECTIONS.has(collectionName) || (typeof window !== 'undefined' && window.__cluster_task_history === 'all')) {
        return true;
    }
    return recordMatchesTaskWindow(record, collectionName, {
        ...getBaseTaskWindow(),
        includeOpenOutside: true
    });
};

const applyQueryOptions = (records, ref) => {
    const options = buildQueryOptions(ref);
    const direction = options.orderDir === 'desc' ? -1 : 1;
    const sorted = [...records].sort((left, right) => {
        const leftValue = left?.[options.orderBy] ?? '';
        const rightValue = right?.[options.orderBy] ?? '';
        if (leftValue === rightValue) return 0;
        return (leftValue > rightValue ? 1 : -1) * direction;
    });
    return options.limit ? sorted.slice(0, options.limit) : sorted;
};

const mergeEntryChanges = (entry, changes = []) => {
    const collectionName = getCollectionName(entry.ref);
    const records = new Map(entry.records.map((record) => [record.id, record]));
    changes.filter((change) => change.collectionName === collectionName).forEach((change) => {
        if (change.action === 'delete' || !change.record || !recordMatchesRef(change.record, entry.ref)) {
            records.delete(change.recordId);
            return;
        }
        records.set(change.recordId, change.record);
    });
    return applyQueryOptions([...records.values()], entry.ref);
};

const buildRegistryKey = (ref) => {
    const collectionName = getCollectionName(ref);
    const options = buildQueryOptions(ref);
    return JSON.stringify({ collectionName, ...options });
};

const fetchRecords = async (ref) => {
    const collectionName = getCollectionName(ref);
    const options = buildQueryOptions(ref);
    const params = new URLSearchParams();
    if (options.orderBy) params.set('orderBy', options.orderBy);
    if (options.orderDir) params.set('orderDir', options.orderDir);
    if (options.limit) params.set('limit', String(options.limit));
    if (TASK_COLLECTIONS.has(collectionName) && (typeof window === 'undefined' || window.__cluster_task_history !== 'all')) {
        const baseWindow = getBaseTaskWindow();
        params.set('dateFrom', baseWindow.dateFrom);
        params.set('dateTo', baseWindow.dateTo);
        params.set('includeOpenBefore', '1');
    }
    const payload = await apiFetch(`/api/collections/${collectionName}?${params.toString()}`);
    return Array.isArray(payload?.records) ? payload.records : [];
};

const notifyListeners = (entry) => {
    const snapshot = createQuerySnapshot(entry.records);
    entry.listeners.forEach((listener) => {
        try {
            listener.onNext(snapshot);
        } catch (error) {
            console.error('Error en listener local de coleccion:', error);
        }
    });
};

const updateEntryRecords = (entry, records) => {
    const normalizedRecords = applyQueryOptions(records, entry.ref);
    const signature = JSON.stringify(normalizedRecords);
    if (signature === entry.signature) return;
    entry.records = normalizedRecords;
    entry.signature = signature;
    notifyListeners(entry);
};

const handleEntryError = (entry, error) => {
    if (error.status === 401 || error.status === 403) {
        updateEntryRecords(entry, []);
        return;
    }
    entry.listeners.forEach((listener) => listener.onError?.(error));
};

const ensureSyncCursor = async (collectionName) => {
    if (syncCursors.has(collectionName)) return syncCursors.get(collectionName);
    if (!latestCursorPromise) {
        latestCursorPromise = apiFetch('/api/collections/_sync?latest=1')
            .then((payload) => Number(payload?.cursor || 0))
            .catch((error) => {
                latestCursorPromise = null;
                throw error;
            });
    }
    const cursor = await latestCursorPromise;
    syncCursors.set(collectionName, cursor);
    return cursor;
};

const hasCollectionListeners = (collectionName) => [...registry.values()].some(
    (entry) => entry.listeners.size > 0 && getCollectionName(entry.ref) === collectionName
);

const getLiveCollectionsForView = (view, hasListeners = hasCollectionListeners) => (
    (LIVE_COLLECTION_BY_VIEW[view] || []).filter(hasListeners)
);

const getLiveCollections = () => {
    if (typeof window === 'undefined') return [];
    const viewCollections = getLiveCollectionsForView(window.__cluster_active_view || '');
    const chatCollections = ['client_chats', 'chat_reactions', 'chat_pins'].filter(hasCollectionListeners);
    return [...new Set([...viewCollections, ...chatCollections])];
};

const shouldPollNow = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
    // La sala tiene que seguir recibiendo tareas aunque nadie toque la pantalla.
    // Si el sondeo se duerme, lo asignado a la tarde recién aparece al otro día.
    return getLiveCollections().length > 0;
};

const getPollMs = () => {
    const configured = Number(typeof window !== 'undefined' ? window.__cluster_poll_ms : DEFAULT_POLL_MS);
    if (Number.isFinite(configured) && configured >= 10000) return configured;
    if (hasCollectionListeners('client_chats')) return CHAT_POLL_MS;
    const live = getLiveCollections();
    if (live.some((name) => TASK_COLLECTIONS.has(name) || name === 'events')) return ROOM_POLL_MS;
    return DEFAULT_POLL_MS;
};

const applyServerChanges = (changes) => {
    registry.forEach((entry) => {
        if (entry.listeners.size === 0) return;
        const nextRecords = mergeEntryChanges(entry, changes);
        updateEntryRecords(entry, nextRecords);
    });
};

const syncCollections = async (collectionNames = []) => {
    const collections = [...new Set(collectionNames.map(String).filter(Boolean))];
    if (collections.length === 0) return;
    const cursors = await Promise.all(collections.map(ensureSyncCursor));
    let cursor = Math.min(...cursors);
    let hasMore = false;
    do {
        const params = new URLSearchParams({
            collections: collections.join(','),
            cursor: String(cursor)
        });
        const payload = await apiFetch(`/api/collections/_sync?${params.toString()}`);
        applyServerChanges(Array.isArray(payload?.changes) ? payload.changes : []);
        cursor = Number(payload?.cursor || cursor);
        collections.forEach((collectionName) => syncCursors.set(collectionName, cursor));
        hasMore = payload?.hasMore === true;
    } while (hasMore);
};

const syncCollection = (collectionName) => syncCollections([collectionName]);

const pauseSync = () => {
    if (syncTimerId) window.clearTimeout(syncTimerId);
    syncTimerId = null;
};

const scheduleSync = (delay = getPollMs()) => {
    if (syncTimerId || syncInFlight || !shouldPollNow() || getLiveCollections().length === 0) return;
    syncTimerId = window.setTimeout(runSync, delay);
};

const runSync = async () => {
    syncTimerId = null;
    const collections = getLiveCollections();
    if (!shouldPollNow() || collections.length === 0 || syncInFlight) return;
    syncInFlight = true;
    try {
        await Promise.all(collections.map(syncCollection));
    } catch (error) {
        registry.forEach((entry) => entry.listeners.forEach((listener) => listener.onError?.(error)));
    } finally {
        syncInFlight = false;
        scheduleSync();
    }
};

const resumeSync = () => {
    if (!syncTimerId && !syncInFlight) scheduleSync(0);
};

const startPolling = (key, ref) => {
    const entry = registry.get(key);
    if (!entry || entry.started) return;
    entry.started = true;

    const run = async () => {
        try {
            const collectionName = getCollectionName(ref);
            const cursorBeforeFetch = syncCursors.has(collectionName)
                ? syncCursors.get(collectionName)
                : await apiFetch('/api/collections/_sync?latest=1').then((payload) => Number(payload?.cursor || 0));
            const records = await fetchRecords(ref);
            const knownCursor = syncCursors.get(collectionName);
            syncCursors.set(
                collectionName,
                Number.isFinite(knownCursor) ? Math.min(knownCursor, cursorBeforeFetch) : cursorBeforeFetch,
            );
            updateEntryRecords(entry, records);
            await syncCollection(collectionName);
        } catch (error) {
            handleEntryError(entry, error);
            if (error.status !== 401 && error.status !== 403) {
                entry.started = false;
                window.setTimeout(() => startPolling(key, ref), getPollMs());
            }
        } finally {
            resumeSync();
        }
    };

    run();
};

const stopPollingIfUnused = (key) => {
    const entry = registry.get(key);
    if (!entry || entry.listeners.size > 0) return;
    registry.delete(key);
    pauseSync();
    resumeSync();
};

const refreshCollection = async (collectionName) => {
    const keys = [...registry.keys()].filter((key) => key.includes(`"collectionName":"${collectionName}"`));
    await Promise.all(keys.map(async (key) => {
        const entry = registry.get(key);
        if (!entry) return;
        try {
            const records = await fetchRecords(entry.ref);
            updateEntryRecords(entry, records);
        } catch (error) {
            handleEntryError(entry, error);
        }
    }));
};

const applyLocalChange = (collectionName, recordId, action, record = null) => {
    applyServerChanges([{ collectionName, recordId, action, record }]);
};

if (typeof document !== 'undefined') {
    const markActivity = () => {
        lastActivityAt = Date.now();
        resumeSync();
    };
    const refreshStaticOnFocus = () => {
        const now = Date.now();
        if (now - lastFocusRefreshAt < 10000) return;
        lastFocusRefreshAt = now;
        syncCollections([
            ...new Set([
                ...[...STATIC_COLLECTIONS].filter(hasCollectionListeners),
                ...getLiveCollections()
            ])
        ]).catch(() => {});
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
        window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener('focus', () => {
        markActivity();
        refreshStaticOnFocus();
    });
    window.addEventListener('cluster:viewchange', () => {
        pauseSync();
        markActivity();
    });
    window.addEventListener('cluster:push', (event) => {
        const collections = Array.isArray(event.detail?.collections)
            ? [...new Set(event.detail.collections.map(String))]
            : [];
        Promise.all(
            collections
                .filter(hasCollectionListeners)
                .map(syncCollection)
        ).catch(() => {});
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            markActivity();
            refreshStaticOnFocus();
        } else {
            pauseSync();
        }
    });
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type !== 'cluster:push') return;
            const collections = Array.isArray(event.data.collections)
                ? event.data.collections
                : ['client_chats'];
            window.dispatchEvent(new CustomEvent('cluster:push', {
                detail: { collections }
            }));
        });
    }
}

export const initializeFirestore = (app, options = {}) => ({ app, options });

export const getFirestore = (app) => ({ app });

export const connectFirestoreEmulator = () => { };

export const persistentLocalCache = (config = {}) => config;

export const persistentMultipleTabManager = () => ({});

export const collection = (_db, ...segments) => ({ __kind: 'collection', segments });

export const doc = (_db, ...segments) => ({ __kind: 'doc', segments });

export const query = (baseRef, ...constraints) => ({ __kind: 'query', baseRef, constraints });

export const orderBy = (field, direction = 'asc') => ({ type: 'orderBy', field, direction });

export const limit = (count) => ({ type: 'limit', count });

export const loadAllTaskHistory = async () => {
    window.__cluster_task_history = 'all';
    await Promise.all(['account_tasks', 'editing', 'management_tasks'].map(refreshCollection));
};

export const refreshReportData = async () => {
    if (typeof window !== 'undefined') {
        window.__cluster_task_history = 'all';
    }
    await Promise.all([
        'account_tasks',
        'editing',
        'management_tasks',
        'users',
        'managers',
        'editors',
        'clients'
    ].map(refreshCollection));
};

export const onSnapshot = (ref, onNext, onError) => {
    const key = buildRegistryKey(ref);
    if (!registry.has(key)) {
        registry.set(key, {
            ref,
            listeners: new Set(),
            records: [],
            signature: '',
            started: false
        });
    }

    const entry = registry.get(key);
    const listener = { onNext, onError };
    entry.listeners.add(listener);
    startPolling(key, ref);

    if (entry.signature) {
        onNext(createQuerySnapshot(entry.records));
    }

    return () => {
        entry.listeners.delete(listener);
        stopPollingIfUnused(key);
    };
};

export const addDoc = async (collectionRef, data) => {
    const collectionName = getCollectionName(collectionRef);
    const payload = await apiFetch(`/api/collections/${collectionName}`, {
        method: 'POST',
        body: JSON.stringify({ data })
    });
    applyLocalChange(collectionName, payload.record.id, 'upsert', payload.record);
    return {
        id: payload.record.id,
        ...payload.record
    };
};

export const updateDoc = async (docRef, data) => {
    const collectionName = getCollectionName(docRef);
    const recordId = getRecordId(docRef);
    const payload = await apiFetch(`/api/collections/${collectionName}/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ data })
    });
    applyLocalChange(collectionName, recordId, 'upsert', payload.record);
    return payload.record;
};

export const moveKanbanTask = async ({
    collectionName,
    taskId,
    targetStatus,
    beforeId = '',
    statusPatch = {}
} = {}) => {
    const payload = await apiFetch('/api/collections/_kanban/move', {
        method: 'POST',
        body: JSON.stringify({ collectionName, taskId, targetStatus, beforeId, statusPatch })
    });
    (Array.isArray(payload?.records) ? payload.records : []).forEach((record) => {
        applyLocalChange(collectionName, record.id, 'upsert', record);
    });
    return payload?.task || null;
};

export const deleteDoc = async (docRef) => {
    const collectionName = getCollectionName(docRef);
    const recordId = getRecordId(docRef);
    await apiFetch(`/api/collections/${collectionName}/${recordId}`, {
        method: 'DELETE'
    });
    applyLocalChange(collectionName, recordId, 'delete');
};

export const setDoc = async (docRef, data, options = {}) => {
    const collectionName = getCollectionName(docRef);
    const recordId = getRecordId(docRef);
    const payload = await apiFetch(`/api/collections/${collectionName}/${recordId}`, {
        method: 'PUT',
        body: JSON.stringify({
            data,
            merge: options.merge !== false
        })
    });
    applyLocalChange(collectionName, recordId, 'upsert', payload.record);
    return payload.record;
};

export const getDocs = async (ref) => {
    const records = await fetchRecords(ref);
    return createQuerySnapshot(records);
};

export const getDoc = async (docRef) => {
    const collectionName = getCollectionName(docRef);
    const recordId = getRecordId(docRef);
    const payload = await apiFetch(`/api/collections/${collectionName}/${recordId}`);
    return createDocSnapshot(payload.record);
};

export const writeBatch = () => {
    const ops = [];
    return {
        update(docRef, data) {
            ops.push({
                action: 'update',
                collectionName: getCollectionName(docRef),
                recordId: getRecordId(docRef),
                data
            });
            return this;
        },
        set(docRef, data, options = {}) {
            ops.push({
                action: 'set',
                collectionName: getCollectionName(docRef),
                recordId: getRecordId(docRef),
                data,
                merge: options.merge !== false
            });
            return this;
        },
        delete(docRef) {
            ops.push({
                action: 'delete',
                collectionName: getCollectionName(docRef),
                recordId: getRecordId(docRef)
            });
            return this;
        },
        async commit() {
            if (ops.length === 0) return;
            await apiFetch('/api/collections/_batch', {
                method: 'POST',
                body: JSON.stringify({ ops })
            });
            const collectionNames = [...new Set(ops.map((item) => item.collectionName))];
            await Promise.all(collectionNames.map((collectionName) => refreshCollection(collectionName)));
        }
    };
};

export const _pollingInternals = {
    isPollingAllowed,
    mergeEntryChanges,
    recordMatchesRef,
    getBaseTaskWindow,
    getLiveCollectionsForView
};
