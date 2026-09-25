import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clusterag-uploads-'));
const emptyEnv = path.join(tempDir, 'empty.env');
await writeFile(emptyEnv, '');

Object.assign(process.env, {
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: emptyEnv,
    DATABASE_CLIENT: 'sqlite3',
    DATABASE_URL: '',
    POSTGRES_URL: '',
    POSTGRES_PRISMA_URL: '',
    POSTGRES_URL_NON_POOLING: '',
    DATABASE_URL_UNPOOLED: '',
    SQLITE_FILENAME: path.join(tempDir, 'uploads.sqlite'),
    SESSION_SECRET: 'uploads-test-secret-32-characters-min',
    SESSION_COOKIE_NAME: 'cluster_session',
    APP_BASE_URL: 'https://app.example.test',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    RUN_BOOTSTRAP_ON_START: 'false',
    SEED_SUPER_ADMIN_EMAILS: 'bootstrap@example.test',
    SEED_MANAGEMENT_TEAM_JSON: '[]',
    SEED_EDITOR_TEAM_JSON: '[]',
    R2_ACCOUNT_ID: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    R2_BUCKET: ''
});

const [{ createApp }, { db }, { createRecord }, { randomToken, sha256 }, { addHoursToIso, nowIso }] = await Promise.all([
    import('../app.js'),
    import('../db/knex.js'),
    import('../lib/records.js'),
    import('../lib/crypto.js'),
    import('../lib/time.js')
]);

let server;
let baseUrl;
let editorToken;

const request = async (pathname, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            ...(token ? { cookie: `cluster_session=${token}` } : {}),
            ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
};

before(async () => {
    const app = await createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await createRecord({
        collectionName: 'users',
        recordId: 'editor-uploads',
        payload: {
            name: 'Editor Uploads',
            email: 'editor-uploads@example.test',
            role: 'editor',
            isActive: true
        }
    });
    const token = randomToken(48);
    await db('auth_sessions').insert({
        session_id: sha256(token),
        user_record_id: 'editor-uploads',
        provider: 'test',
        expires_at: addHoursToIso(1),
        last_seen_at: nowIso(),
        created_at: nowIso()
    });
    editorToken = token;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.destroy();
    await rm(tempDir, { recursive: true, force: true });
});

test('upload status requires a session', async () => {
    const anon = await request('/api/uploads/status');
    assert.equal(anon.status, 401);
    const authed = await request('/api/uploads/status', { token: editorToken });
    assert.equal(authed.status, 200);
    assert.equal(authed.payload.r2, false);
});

test('signing an upload without R2 stays unavailable', async () => {
    const response = await request('/api/uploads/sign', {
        token: editorToken,
        method: 'POST',
        body: {
            collectionName: 'editing',
            taskId: 'task-1',
            fileName: 'corte.mp4',
            contentType: 'video/mp4',
            size: 1200
        }
    });
    assert.equal(response.status, 503);
    assert.equal(response.payload?.error?.code, 'uploads/not-configured');
});
