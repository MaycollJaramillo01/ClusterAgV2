import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Se ejecutan los adaptadores reales juntos; solo se simula el proveedor
// externo. Cada bundle tiene su propio singleton de autenticacion.
const { outputFiles } = await build({
    stdin: {
        contents: `export * from './firebase-auth-compat.js';
            export { apiFetch } from './backend-api.js?v=20260525-local-api';`,
        resolveDir: fileURLToPath(new URL('.', import.meta.url))
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
        name: 'fake-firebase-provider',
        setup(builder) {
            builder.onResolve({ filter: /^firebase\/(app|auth)$/ }, (args) => ({ path: args.path, namespace: 'fake' }));
            builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `
                export const getApps = () => [];
                export const getApp = () => ({});
                export const initializeApp = () => ({});
                export const getAuth = () => globalThis.testFirebaseAuth;
                export const sendSignInLinkToEmail = async () => {};
                export const signInWithEmailLink = async () => {};
                export const signOut = async () => {};
            ` }));
        }
    }]
});
const bundle = Buffer.from(outputFiles[0].text).toString('base64');
let instance = 0;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const user = { uid: 'test-isabel', email: 'isabel@example.test', emailVerified: true };
const json = (payload, status = 200) => Response.json(payload, { status });
const expired = () => json({ error: { code: 'auth/session-required' } }, 401);
const loadAuth = async () => {
    globalThis.window = {
        location: { protocol: 'https:', hostname: 'app.example.test' },
        __cluster_firebase_config: { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test' }
    };
    return import(`data:text/javascript;base64,${bundle}#instance-${instance++}`);
};
afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    delete globalThis.testFirebaseAuth;
});

test('espera a que Firebase restaure su usuario antes de intercambiar la sesion', async () => {
    let ready = false;
    const provider = { email: user.email, getIdToken: async () => 'provider-token' };
    globalThis.testFirebaseAuth = {
        currentUser: null,
        async authStateReady() {
            await Promise.resolve();
            ready = true;
            this.currentUser = provider;
        }
    };
    globalThis.fetch = async (url, options) => {
        if (url === '/api/auth/session') return json({ user: null });
        assert.equal(url, '/api/auth/firebase/session');
        assert.equal(ready, true);
        assert.deepEqual(JSON.parse(options.body), { idToken: 'provider-token', email: user.email });
        return json({ user });
    };
    const { getAuth } = await loadAuth();
    const auth = getAuth({});
    await auth.authStateReady();
    assert.equal(auth.currentUser.email, user.email);
});

test('una sesion perdida durante la creacion se recupera con el proveedor y guarda una vez', async () => {
    let session = true;
    let saved = 0;
    let exchanges = 0;
    globalThis.testFirebaseAuth = {
        authStateReady: async () => {},
        currentUser: { email: user.email, getIdToken: async () => 'provider-token' }
    };
    globalThis.fetch = async (url) => {
        if (url === '/api/auth/session') return json({ user: session ? user : null });
        if (url === '/api/auth/firebase/session') {
            exchanges += 1;
            session = true;
            return json({ user });
        }
        if (!session) return expired();
        saved += 1;
        return json({ record: { id: 'test-client' } }, 201);
    };
    const { getAuth, apiFetch } = await loadAuth();
    const auth = getAuth({});
    await auth.authStateReady();
    session = false;
    await apiFetch('/api/collections/clients', { method: 'POST', body: '{}' });
    assert.equal(auth.currentUser.email, user.email);
    assert.equal(exchanges, 1);
    assert.equal(saved, 1);
});

test('una sesion irrecuperable actualiza la interfaz y explica que debe iniciar acceso', async () => {
    let session = true;
    globalThis.testFirebaseAuth = { currentUser: null, authStateReady: async () => {} };
    globalThis.fetch = async (url) => url === '/api/auth/session' ? json({ user: session ? user : null }) : expired();
    const { getAuth, onAuthStateChanged, apiFetch } = await loadAuth();
    const auth = getAuth({});
    await auth.authStateReady();
    const changes = [];
    onAuthStateChanged(auth, (nextUser, reason) => changes.push({ nextUser, reason }));
    session = false;
    await assert.rejects(apiFetch('/api/collections/clients'), { code: 'auth/session-required' });
    assert.equal(auth.currentUser, null);
    assert.deepEqual(changes.at(-1), { nextUser: null, reason: 'session-expired' });
});

test('no repite una creacion pendiente con la cuenta iniciada en otra pestaña', async () => {
    let account = user;
    let mutations = 0;
    globalThis.fetch = async (url) => {
        if (url === '/api/auth/session') return json({ user: account });
        mutations += 1;
        return expired();
    };
    const { getAuth, apiFetch } = await loadAuth();
    const auth = getAuth({});
    await auth.authStateReady();
    account = { ...user, uid: 'other', email: 'other@example.test' };
    await assert.rejects(apiFetch('/api/collections/clients', { method: 'POST' }), { code: 'auth/session-required' });
    assert.equal(mutations, 1);
    assert.equal(auth.currentUser, null);
});

test('un fallo de red del proveedor conserva la cuenta y permite intentar mas tarde', async () => {
    let session = true;
    globalThis.testFirebaseAuth = {
        authStateReady: async () => {},
        currentUser: { email: user.email, getIdToken: async () => { throw Object.assign(new Error('Sin conexión'), { code: 'auth/network-request-failed' }); } }
    };
    globalThis.fetch = async (url) => url === '/api/auth/session' ? json({ user: session ? user : null }) : expired();
    const { getAuth, apiFetch } = await loadAuth();
    const auth = getAuth({});
    await auth.authStateReady();
    session = false;
    await assert.rejects(apiFetch('/api/collections/clients'), { code: 'auth/network-request-failed' });
    assert.equal(auth.currentUser.email, user.email);
});
