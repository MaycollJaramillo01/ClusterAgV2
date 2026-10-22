const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

const isLocalWebOrigin = () => typeof window !== 'undefined'
    && ['http:', 'https:'].includes(window.location.protocol)
    && LOCAL_HOSTNAMES.has(window.location.hostname);

const resolveApiBaseUrl = () => {
    const configuredBaseUrl = String(window.__cluster_api_base_url || '').replace(/\/+$/, '');
    if (isLocalWebOrigin() && configuredBaseUrl === 'https://clusterag.vercel.app') return '';
    return configuredBaseUrl;
};

export const buildApiUrl = (path) => `${resolveApiBaseUrl()}${path}`;

let sessionHandlers = {};
let sessionRecoveryPromise = null;

export const setApiSessionHandlers = (handlers = {}) => {
    sessionHandlers = handlers;
};

const recoverSession = () => {
    if (!sessionRecoveryPromise) {
        sessionRecoveryPromise = Promise.resolve()
            .then(() => sessionHandlers.recover?.() || false)
            .finally(() => { sessionRecoveryPromise = null; });
    }
    return sessionRecoveryPromise;
};

export const apiFetch = async (path, options = {}, retrySession = true) => {
    const response = await fetch(buildApiUrl(path), {
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const hasJson = response.headers.get('content-type')?.includes('application/json');
    const payload = hasJson ? await response.json() : null;

    if (!response.ok) {
        const sessionRequired = response.status === 401
            && payload?.error?.code === 'auth/session-required'
            && !path.startsWith('/api/auth/');

        // Este 401 se emite antes de ejecutar la mutacion. Solo se repite una
        // vez, tras recuperar la identidad; los errores de red no se repiten.
        if (sessionRequired) {
            if (retrySession && await recoverSession()) {
                return apiFetch(path, options, false);
            }
            sessionHandlers.expire?.();
        }

        const message = sessionRequired
            ? 'Tu sesión venció. Inicia sesión de nuevo para continuar.'
            : payload?.error?.message || `Request failed with status ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.code = payload?.error?.code || '';
        throw error;
    }

    return payload;
};

export const sendApiBeacon = (path) => {
    const url = buildApiUrl(path);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        return navigator.sendBeacon(url);
    }
    if (typeof fetch === 'function') {
        fetch(url, {
            method: 'POST',
            credentials: 'include',
            keepalive: true
        }).catch(() => {});
        return true;
    }
    return false;
};

export const getApiOrigin = () => {
    const base = resolveApiBaseUrl();
    if (!base) return window.location.origin;
    return new URL(base, window.location.origin).origin;
};
