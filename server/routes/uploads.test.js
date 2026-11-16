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
    assert.equal(authed.payload.taskMaxBytes, 1_000_000_000);
    assert.equal(authed.payload.maxBytes, 1_000_000_000);
    assert.equal(authed.payload.retentionDays, 0);
});

test('task uploads accept a 1 GB limit and reject files above it', async () => {
    const tooLarge = await request('/api/uploads/sign', {
        token: editorToken,
        method: 'POST',
        body: {
            collectionName: 'editing',
            taskId: 'task-1',
            fileName: 'corte.mp4',
            contentType: 'video/mp4',
            size: 1_000_000_001
        }
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.payload?.error?.code, 'attachment/too-large');

    const withinLimit = await request('/api/uploads/sign', {
        token: editorToken,
        method: 'POST',
        body: {
            collectionName: 'editing',
            taskId: 'task-1',
            fileName: 'corte.mp4',
            contentType: 'video/mp4',
            size: 1_000_000_000
        }
    });
    // The limit check passes; this test task is intentionally absent.
    assert.equal(withinLimit.status, 404);
    assert.equal(withinLimit.payload?.error?.code, 'document/not-found');
});

test('signing an upload without R2 creates an authenticated database upload session', async () => {
    const bytes = Buffer.from('small test attachment');
    await createRecord({
        collectionName: 'editing',
        recordId: 'task-1',
        payload: { title: 'Tarea de edición', status: 'editar', attachments: [] }
    });
    const response = await request('/api/uploads/sign', {
        token: editorToken,
        method: 'POST',
        body: {
            collectionName: 'editing',
            taskId: 'task-1',
            fileName: 'corte.mp4',
            contentType: 'video/mp4',
            size: bytes.length
        }
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.storage, 'database');
    assert.match(response.payload.uploadUrl, /mode=chunked/);
    assert.ok(response.payload.key.startsWith('tasks/editing/task-1/'));

    const uploadUrl = new URL(response.payload.uploadUrl);
    uploadUrl.searchParams.set('part', '0');
    const uploaded = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            cookie: `cluster_session=${editorToken}`,
            'content-type': 'application/octet-stream'
        },
        body: bytes
    });
    assert.equal(uploaded.status, 200);
    assert.equal((await uploaded.json()).complete, true);

    const resolved = await request('/api/uploads/url', {
        token: editorToken,
        method: 'POST',
        body: { key: response.payload.key, storage: 'database' }
    });
    assert.equal(resolved.status, 200);
    const downloaded = await fetch(resolved.payload.url, {
        headers: { cookie: `cluster_session=${editorToken}` }
    });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
});

test('task activity records opens and field names for task updates', async () => {
    const opened = await request('/api/activity/open', {
        token: editorToken,
        method: 'POST',
        body: { collectionName: 'editing', taskId: 'task-1' }
    });
    assert.equal(opened.status, 201);

    const updated = await request('/api/collections/editing/task-1', {
        token: editorToken,
        method: 'PATCH',
        body: { data: { title: 'Tarea actualizada' } }
    });
    assert.equal(updated.status, 200);

    const activity = await request('/api/activity?actorId=editor-uploads&limit=10', {
        token: editorToken
    });
    assert.equal(activity.status, 200);
    assert.deepEqual(activity.payload.events.map((event) => event.action), ['updated', 'opened']);
    assert.deepEqual(activity.payload.events[0].fields, ['title']);
    assert.ok(Number.isFinite(Date.parse(activity.payload.events[0].createdAt)));
});

test('chat uploads require membership in the conversation', async () => {
    await createRecord({
        collectionName: 'clients',
        recordId: 'client-chat-upload',
        payload: { name: 'Cliente chat', managerId: '' }
    });
    const body = {
        collectionName: 'client_chats',
        clientId: 'client-chat-upload',
        fileName: 'nota.png',
        contentType: 'image/png',
        size: 4
    };
    const denied = await request('/api/uploads/sign', {
        token: editorToken,
        method: 'POST',
        body
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.payload?.error?.code, 'chat-groups/membership-required');

    await createRecord({
        collectionName: 'chat_group_memberships',
        recordId: 'client-chat-upload',
        payload: {
            clientId: 'client-chat-upload',
            memberIds: ['editor-uploads'],
            updatedAt: nowIso()
        }
    });
    const allowed = await request('/api/uploads/sign', {
        token: editorToken,
        method: 'POST',
        body
    });
    assert.equal(allowed.status, 200);
    assert.ok(String(allowed.payload?.key || '').startsWith('chats/client-chat-upload/'));
});
