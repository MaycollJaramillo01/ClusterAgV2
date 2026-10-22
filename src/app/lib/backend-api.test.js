import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { apiFetch, setApiSessionHandlers } from './backend-api.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
globalThis.window = {
    location: { protocol: 'https:', hostname: 'app.example.test', origin: 'https://app.example.test' }
};
const json = (payload, status = 200) => Response.json(payload, { status });
const expired = () => json({ error: { code: 'auth/session-required', message: 'Se requiere una sesion activa.' } }, 401);

afterEach(() => {
    globalThis.fetch = originalFetch;
    setApiSessionHandlers();
});
process.on('exit', () => { globalThis.window = originalWindow; });

test('recupera la sesion y repite una sola vez el mismo formulario', async () => {
    let recoveries = 0;
    const requests = [];
    setApiSessionHandlers({ recover: async () => { recoveries += 1; return true; } });
    globalThis.fetch = async (url, options) => {
        requests.push({ url, options });
        return requests.length === 1 ? expired() : json({ record: { id: 'client-1' } }, 201);
    };
    const options = { method: 'POST', body: JSON.stringify({ data: { name: 'Cliente de prueba' } }) };
    assert.deepEqual(await apiFetch('/api/collections/clients', options), { record: { id: 'client-1' } });
    assert.equal(recoveries, 1);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(requests[1].options.credentials, 'include');
});

test('peticiones concurrentes comparten una recuperacion de sesion', async () => {
    let recoveries = 0;
    let recovered = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    setApiSessionHandlers({ recover: async () => {
        recoveries += 1;
        await gate;
        recovered = true;
        return true;
    } });
    globalThis.fetch = async () => recovered ? json({ records: [] }) : expired();
    const pending = ['/api/collections/clients', '/api/collections/managers'].map((url) => apiFetch(url));
    await new Promise(setImmediate);
    assert.equal(recoveries, 1);
    release();
    await Promise.all(pending);
    assert.equal(recoveries, 1);
});

test('si no recupera la sesion pide acceso y no repite la mutacion', async () => {
    let requests = 0;
    let expirations = 0;
    setApiSessionHandlers({ recover: async () => false, expire: () => { expirations += 1; } });
    globalThis.fetch = async () => { requests += 1; return expired(); };
    await assert.rejects(apiFetch('/api/collections/clients', { method: 'POST' }), (error) => {
        assert.equal(error.code, 'auth/session-required');
        assert.equal(error.status, 401);
        assert.match(error.message, /Inicia sesión de nuevo/);
        return true;
    });
    assert.equal(requests, 1);
    assert.equal(expirations, 1);
});

test('un segundo 401 termina el reintento incluso si la cookie no se guardo', async () => {
    let requests = 0;
    let recoveries = 0;
    let expirations = 0;
    setApiSessionHandlers({
        recover: async () => { recoveries += 1; return true; },
        expire: () => { expirations += 1; }
    });
    globalThis.fetch = async () => { requests += 1; return expired(); };
    await assert.rejects(apiFetch('/api/collections/clients'), { code: 'auth/session-required' });
    assert.equal(requests, 2);
    assert.equal(recoveries, 1);
    assert.equal(expirations, 1);
});

test('no recupera sesiones ante permisos denegados ni en endpoints de autenticacion', async () => {
    let recoveries = 0;
    let expirations = 0;
    setApiSessionHandlers({
        recover: () => { recoveries += 1; },
        expire: () => { expirations += 1; }
    });
    globalThis.fetch = async () => json({ error: { code: 'auth/insufficient-permission', message: 'Sin permiso' } }, 403);
    await assert.rejects(apiFetch('/api/collections/clients'), { message: 'Sin permiso' });
    globalThis.fetch = async () => expired();
    await assert.rejects(apiFetch('/api/auth/firebase/session'), { code: 'auth/session-required' });
    assert.equal(recoveries, 0);
    assert.equal(expirations, 0);
});

test('los fallos de red no repiten un POST que pudo haberse guardado', async () => {
    let requests = 0;
    globalThis.fetch = async () => { requests += 1; throw new TypeError('Failed to fetch'); };
    await assert.rejects(apiFetch('/api/collections/clients', { method: 'POST' }), { message: 'Failed to fetch' });
    assert.equal(requests, 1);
});

test('un fallo temporal al recuperar no cierra la sesion ni repite la mutacion', async () => {
    let expirations = 0;
    setApiSessionHandlers({
        recover: async () => { throw new Error('Servicio temporalmente no disponible'); },
        expire: () => { expirations += 1; }
    });
    globalThis.fetch = async () => expired();
    await assert.rejects(apiFetch('/api/collections/clients'), { message: 'Servicio temporalmente no disponible' });
    assert.equal(expirations, 0);
});
