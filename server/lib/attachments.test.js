import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildObjectKey,
    parseObjectKey,
    sanitizeAttachments,
    sanitizeFileName
} from './attachments.js';

const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('sanitizeFileName strips paths and unsafe characters', () => {
    assert.equal(sanitizeFileName('../../informe final.mp4'), 'informe_final.mp4');
});

test('object keys are scoped to a task and can be parsed back', () => {
    const key = buildObjectKey({
        collectionName: 'editing',
        taskId: 'task-1',
        attachmentId: 'att123',
        fileName: 'corte final.mp4'
    });
    assert.equal(key, 'tasks/editing/task-1/att123/corte_final.mp4');
    assert.deepEqual(parseObjectKey(key), {
        kind: 'task',
        collectionName: 'editing',
        parentId: 'task-1',
        taskId: 'task-1',
        attachmentId: 'att123',
        fileName: 'corte_final.mp4'
    });
    assert.equal(parseObjectKey('tasks/other/task-1/att/file.mp4'), null);
});

test('stored attachments keep metadata without embedded bytes', () => {
    const [attachment] = sanitizeAttachments([{
        id: 'att123',
        name: 'corte.mp4',
        type: 'video/mp4',
        size: 12_000_000,
        key: 'tasks/editing/task-1/att123/corte.mp4',
        storage: 'r2',
        uploadedBy: 'Editor',
        uploadedAt: '2026-09-24T12:00:00.000Z'
    }], { collectionName: 'editing', recordId: 'task-1' });

    assert.equal(attachment.storage, 'r2');
    assert.equal(attachment.key, 'tasks/editing/task-1/att123/corte.mp4');
    assert.equal(attachment.data, undefined);
    assert.equal(attachment.size, 12_000_000);
});

test('database-backed task attachments retain their database storage provider', () => {
    const [attachment] = sanitizeAttachments([{
        id: 'att-db',
        name: 'brief.pdf',
        type: 'application/pdf',
        size: 12_000_000,
        key: 'tasks/editing/task-1/att-db/brief.pdf',
        storage: 'database'
    }], { collectionName: 'editing', recordId: 'task-1' });
    assert.equal(attachment.storage, 'database');
});

test('stored attachments cannot jump to another task or collection', () => {
    assert.throws(
        () => sanitizeAttachments([{
            name: 'corte.mp4',
            type: 'video/mp4',
            size: 1000,
            key: 'tasks/editing/other-task/att123/corte.mp4'
        }], { collectionName: 'editing', recordId: 'task-1' }),
        { code: 'attachment/key-mismatch' }
    );
    assert.throws(
        () => sanitizeAttachments([{
            name: 'nota.pdf',
            type: 'application/pdf',
            size: 1000,
            key: 'tasks/editing/task-1/att123/nota.pdf'
        }], { collectionName: 'client_chats', recordId: 'msg-1', clientId: 'client-1' }),
        { code: 'attachment/key-mismatch' }
    );
});

test('chat attachments can live in R2 scoped to a client', () => {
    const key = buildObjectKey({
        collectionName: 'client_chats',
        clientId: 'client-1',
        attachmentId: 'att9',
        fileName: 'pieza.mp4'
    });
    assert.equal(key, 'chats/client-1/att9/pieza.mp4');
    const [attachment] = sanitizeAttachments([{
        name: 'pieza.mp4',
        type: 'video/mp4',
        size: 8_000_000,
        key,
        storage: 'r2'
    }], { collectionName: 'client_chats', clientId: 'client-1' });
    assert.equal(attachment.storage, 'r2');
    assert.equal(attachment.key, key);
    assert.throws(
        () => sanitizeAttachments([{
            name: 'pieza.mp4',
            type: 'video/mp4',
            size: 8_000_000,
            key: 'chats/other-client/att9/pieza.mp4'
        }], { collectionName: 'client_chats', clientId: 'client-1' }),
        { code: 'attachment/key-mismatch' }
    );
});

test('embedded attachments still work for chat-sized files', () => {
    const [attachment] = sanitizeAttachments([{
        name: 'foto.png',
        type: 'image/png',
        data: tinyPng
    }], { collectionName: 'client_chats' });
    assert.equal(attachment.type, 'image/png');
    assert.ok(attachment.data.startsWith('data:image/png;base64,'));
});

test('voice notes with MediaRecorder codecs are accepted', () => {
    const payload = 'data:audio/webm;codecs=opus;base64,' + Buffer.from('voice-bytes').toString('base64');
    const [attachment] = sanitizeAttachments([{
        name: 'nota-de-voz-1.webm',
        type: 'audio/webm;codecs=opus',
        data: payload,
        duration: 4,
        isVoiceNote: true
    }], { collectionName: 'client_chats' });
    assert.equal(attachment.type, 'audio/webm');
    assert.equal(attachment.isVoiceNote, true);
    assert.equal(attachment.duration, 4);
    assert.equal(attachment.data, 'data:audio/webm;base64,' + Buffer.from('voice-bytes').toString('base64'));
});
