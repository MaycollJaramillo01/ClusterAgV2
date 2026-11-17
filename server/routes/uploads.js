import express from 'express';
import { createHash } from 'node:crypto';
import { db } from '../db/knex.js';
import { createRecordId } from '../lib/crypto.js';
import { asyncHandler, createHttpError } from '../lib/http.js';
import {
    ALLOWED_ATTACHMENT_TYPES,
    CHAT_ATTACHMENT_COLLECTION,
    TASK_ATTACHMENT_COLLECTIONS,
    MAX_EMBEDDED_ATTACHMENT_BYTES,
    MAX_TASK_ATTACHMENT_UPLOAD_BYTES,
    buildObjectKey,
    inferContentType,
    parseObjectKey
} from '../lib/attachments.js';
import { getCollectionPermission, hasPermission } from '../lib/permissions.js';
import { getRecord } from '../lib/records.js';
import { ensureChatClientAccess } from '../lib/chat-access.js';
import { parseDmClientId } from '../lib/chat-groups.js';
import { env } from '../config/env.js';
import { deleteObject, getR2MaxFileBytes, isR2Configured, publicObjectUrl, signDownloadUrl, signUploadUrl } from '../lib/r2.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';
import { getRequestOrigin } from '../lib/request-origin.js';
import { nowIso } from '../lib/time.js';
import { parseByteRange } from '../lib/media-bytes.js';

const router = express.Router();
const DATABASE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
const MEDIA_READ_CHUNK_BYTES = 1024 * 1024;

const readBlobSlice = async (key, start, length) => {
    const sliceSql = db.client.config.client === 'pg'
        ? 'substring(file_data from ?::int for ?::int)'
        : 'substr(file_data, ?, ?)';
    const row = await db('attachment_blobs')
        .where({ key })
        .select(db.raw(`${sliceSql} as file_data`, [start + 1, length]))
        .first();
    if (!row?.file_data) return Buffer.alloc(0);
    return Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
};

const writeBlobRange = async (res, key, start, end) => {
    let aborted = false;
    const stop = () => {
        if (!res.writableEnded) aborted = true;
    };
    res.on('close', stop);
    try {
        for (let offset = start; offset <= end; offset += MEDIA_READ_CHUNK_BYTES) {
            if (aborted) return;
            const sliceEnd = Math.min(end, offset + MEDIA_READ_CHUNK_BYTES - 1);
            const chunk = await readBlobSlice(key, offset, sliceEnd - offset + 1);
            if (aborted) return;
            if (!res.write(chunk)) {
                await new Promise((resolve) => res.once('drain', resolve));
            }
        }
        if (!aborted) res.end();
    } finally {
        res.off('close', stop);
    }
};

const authorizeChatParent = async (userRecord, clientId, action) => {
    requireChatPermission(userRecord, action === 'read' ? 'read' : 'update');
    await ensureChatClientAccess(userRecord, clientId, { allowOversight: true });
    const [client, teamGroup] = await Promise.all([
        getRecord({ collectionName: 'clients', recordId: clientId }),
        getRecord({ collectionName: 'team_groups', recordId: clientId })
    ]);
    if (!client && !teamGroup && !parseDmClientId(clientId)) {
        throw createHttpError(404, 'El cliente no existe.', 'document/not-found');
    }
};

const authorizeAttachmentParent = async (userRecord, parsed, action) => {
    if (parsed.kind === 'chat') {
        await authorizeChatParent(userRecord, parsed.clientId, action);
        return;
    }
    requireTaskPermission(userRecord, parsed.collectionName, action === 'read' ? 'read' : 'update');
    const task = await getRecord({ collectionName: parsed.collectionName, recordId: parsed.taskId });
    if (!task) throw createHttpError(404, 'La tarea no existe.', 'document/not-found');
};

const createDatabaseBlobUrl = (req, key) => {
    const query = new URLSearchParams({ key });
    return `${getRequestOrigin(req)}/api/uploads/blob?${query.toString()}`;
};

const requireTaskPermission = (userRecord, collectionName, action) => {
    if (!TASK_ATTACHMENT_COLLECTIONS.has(collectionName)) {
        throw createHttpError(400, 'La coleccion no admite archivos en R2.', 'uploads/invalid-collection');
    }
    const permission = getCollectionPermission(collectionName, action);
    if (!permission || !hasPermission(userRecord, permission)) {
        throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/insufficient-permission');
    }
};

const requireChatPermission = (userRecord, action) => {
    const permission = action === 'read' ? 'view_client_chat' : 'send_client_chat';
    if (!hasPermission(userRecord, permission)) {
        throw createHttpError(403, 'No tienes permisos para esta accion.', 'auth/insufficient-permission');
    }
};

const resolveParentId = (collectionName, body = {}) => {
    if (collectionName === CHAT_ATTACHMENT_COLLECTION) {
        return String(body.clientId || body.parentId || '').trim();
    }
    return String(body.taskId || body.parentId || '').trim();
};

const getMaxUploadBytes = (collectionName) => {
    const providerLimit = isR2Configured() ? getR2MaxFileBytes() : env.uploads.maxFileBytes;
    return TASK_ATTACHMENT_COLLECTIONS.has(collectionName)
        ? Math.min(providerLimit, MAX_TASK_ATTACHMENT_UPLOAD_BYTES)
        : providerLimit;
};

router.get('/status', asyncHandler(async (req, res) => {
    requireAuthenticatedUser(req);
    res.json({
        r2: isR2Configured(),
        storage: isR2Configured() ? 'r2' : 'database',
        maxBytes: isR2Configured() ? getR2MaxFileBytes() : env.uploads.maxFileBytes,
        taskMaxBytes: getMaxUploadBytes('editing'),
        embeddedMaxBytes: MAX_EMBEDDED_ATTACHMENT_BYTES,
        retentionDays: isR2Configured() ? env.r2.retentionDays : 0,
        publicBaseUrl: isR2Configured() ? (env.r2.publicBaseUrl || '') : ''
    });
}));

router.post('/sign', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);

    const collectionName = String(req.body?.collectionName || '').trim();
    const parentId = resolveParentId(collectionName, req.body);
    const fileName = String(req.body?.fileName || '').trim();
    const contentType = inferContentType(req.body?.fileName, req.body?.contentType);
    const size = Number(req.body?.size);
    const maxFileBytes = getMaxUploadBytes(collectionName);

    if (!parentId || !fileName) {
        throw createHttpError(400, 'Faltan datos del archivo.', 'uploads/invalid-request');
    }
    if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
        throw createHttpError(400, 'El tipo de archivo no esta permitido.', 'attachment/type-denied');
    }
    if (!Number.isFinite(size) || size <= 0 || size > maxFileBytes) {
        throw createHttpError(413, `El archivo supera el limite de ${Math.ceil(maxFileBytes / (1024 * 1024))} MB.`, 'attachment/too-large');
    }

    if (collectionName === CHAT_ATTACHMENT_COLLECTION) {
        await authorizeChatParent(userRecord, parentId, 'update');
    } else {
        requireTaskPermission(userRecord, collectionName, 'update');
        const task = await getRecord({ collectionName, recordId: parentId });
        if (!task) {
            throw createHttpError(404, 'La tarea no existe.', 'document/not-found');
        }
    }

    const attachmentId = createRecordId().replace(/-/g, '').slice(0, 16);
    const key = buildObjectKey({
        collectionName,
        parentId,
        attachmentId,
        fileName
    });
    if (!isR2Configured()) {
        const totalParts = Math.ceil(size / DATABASE_UPLOAD_CHUNK_BYTES);
        const createdAt = nowIso();
        await db('attachment_upload_chunks').where('created_at', '<', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).del();
        await db('attachment_upload_sessions').where('created_at', '<', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).del();
        await db('attachment_upload_sessions').insert({
            object_key: key,
            collection_name: collectionName,
            parent_id: parentId,
            attachment_id: attachmentId,
            file_name: fileName.slice(0, 180),
            content_type: contentType,
            expected_size: size,
            total_parts: totalParts,
            uploaded_by: String(userRecord.id),
            created_at: createdAt
        });
        const uploadUrl = `${createDatabaseBlobUrl(req, key)}&parts=${totalParts}&mode=chunked`;
        res.json({
            uploadUrl,
            key,
            attachmentId,
            storage: 'database',
            publicUrl: '',
            headers: { 'Content-Type': 'application/octet-stream' }
        });
        return;
    }

    const uploadUrl = await signUploadUrl({ key, contentType });
    res.json({
        uploadUrl,
        key,
        attachmentId,
        storage: 'r2',
        publicUrl: publicObjectUrl(key),
        headers: { 'Content-Type': contentType }
    });
}));

router.put('/blob', express.raw({ type: 'application/octet-stream', limit: DATABASE_UPLOAD_CHUNK_BYTES }), asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    const key = String(req.query.key || '').trim();
    const parsed = parseObjectKey(key);
    if (!parsed) throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw createHttpError(400, 'El fragmento del archivo esta vacio.', 'attachment/empty');
    }
    await authorizeAttachmentParent(userRecord, parsed, 'update');

    const session = await db('attachment_upload_sessions').where({ object_key: key }).first();
    if (!session || String(session.uploaded_by) !== String(userRecord.id)) {
        throw createHttpError(404, 'La carga no existe o ya vencio.', 'uploads/session-not-found');
    }
    const totalParts = Number(req.query.parts);
    const partIndex = Number(req.query.part);
    if (totalParts !== Number(session.total_parts) || !Number.isInteger(partIndex)
        || partIndex < 0 || partIndex >= totalParts) {
        throw createHttpError(400, 'El fragmento no corresponde a la carga.', 'uploads/invalid-part');
    }
    const expectedPartSize = partIndex === totalParts - 1
        ? Number(session.expected_size) - DATABASE_UPLOAD_CHUNK_BYTES * (totalParts - 1)
        : DATABASE_UPLOAD_CHUNK_BYTES;
    if (req.body.length !== expectedPartSize) {
        throw createHttpError(400, 'El tamaño del fragmento no es válido.', 'uploads/invalid-part-size');
    }

    const result = await db.transaction(async (trx) => {
        const existingBlob = await trx('attachment_blobs').where({ key }).first();
        if (existingBlob) return { complete: true, uploadedParts: totalParts };

        await trx('attachment_upload_chunks').insert({
            object_key: key,
            part_index: partIndex,
            total_parts: totalParts,
            chunk_data: req.body,
            uploaded_by: String(userRecord.id),
            created_at: nowIso()
        }).onConflict(['object_key', 'part_index']).merge({
            chunk_data: req.body,
            created_at: nowIso()
        });

        const chunks = await trx('attachment_upload_chunks')
            .where({ object_key: key, uploaded_by: String(userRecord.id) })
            .orderBy('part_index', 'asc');
        if (chunks.length !== totalParts) {
            return { complete: false, uploadedParts: chunks.length };
        }
        if (chunks.some((chunk, index) => Number(chunk.part_index) !== index)) {
            throw createHttpError(400, 'Faltan fragmentos del archivo.', 'uploads/missing-parts');
        }
        const fileData = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.chunk_data)));
        if (fileData.length !== Number(session.expected_size)
            || fileData.length > getMaxUploadBytes(session.collection_name)) {
            throw createHttpError(413, 'El archivo no coincide con el tamaño permitido.', 'attachment/too-large');
        }
        await trx('attachment_blobs').insert({
            key,
            collection_name: session.collection_name,
            parent_id: session.parent_id,
            attachment_id: session.attachment_id,
            file_name: session.file_name,
            content_type: session.content_type,
            file_data: fileData,
            file_size: fileData.length,
            uploaded_by: String(userRecord.id),
            created_at: nowIso()
        });
        await trx('attachment_upload_chunks').where({ object_key: key }).del();
        await trx('attachment_upload_sessions').where({ object_key: key }).del();
        return { complete: true, uploadedParts: totalParts };
    });

    res.json({ ok: true, ...result, totalParts });
}));

router.get('/blob', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    const key = String(req.query.key || '').trim();
    const parsed = parseObjectKey(key);
    if (!parsed) throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    await authorizeAttachmentParent(userRecord, parsed, 'read');
    const blob = await db('attachment_blobs')
        .where({ key })
        .first('file_name', 'content_type', 'file_size');
    if (!blob) throw createHttpError(404, 'El archivo no existe.', 'attachment/not-found');
    const size = Number(blob.file_size);
    if (!Number.isFinite(size) || size < 0) {
        throw createHttpError(404, 'El archivo no existe.', 'attachment/not-found');
    }
    const etag = `"${createHash('sha1').update(`${key}:${size}`).digest('hex').slice(0, 20)}"`;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.set('ETag', etag);
    res.set('Accept-Ranges', 'bytes');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(blob.file_name)}`);
    res.type(blob.content_type || 'application/octet-stream');
    if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
    }
    if (size === 0) {
        res.set('Content-Length', '0');
        res.end();
        return;
    }
    const range = parseByteRange(req.headers.range, size);
    if (range?.unsatisfiable) {
        res.status(416);
        res.set('Content-Range', `bytes */${size}`);
        res.end();
        return;
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    if (range) {
        res.status(206);
        res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(end - start + 1));
    await writeBlobRange(res, key, start, end);
}));

router.post('/url', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    const key = String(req.body?.key || '').trim();
    const parsed = parseObjectKey(key);
    if (!parsed) {
        throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    }
    await authorizeAttachmentParent(userRecord, parsed, 'read');

    if (req.body?.storage === 'database') {
        const blob = await db('attachment_blobs').where({ key }).first();
        if (!blob) throw createHttpError(404, 'El archivo no existe.', 'attachment/not-found');
        const query = new URLSearchParams({ key });
        if (req.body?.download) query.set('download', '1');
        res.json({ url: `${getRequestOrigin(req)}/api/uploads/blob?${query.toString()}`, expiresIn: 0 });
        return;
    }
    if (!isR2Configured()) {
        throw createHttpError(503, 'El almacenamiento remoto no esta configurado para este archivo.', 'uploads/not-configured');
    }

    const publicUrl = publicObjectUrl(key);
    const url = publicUrl || await signDownloadUrl({
        key,
        downloadName: req.body?.download ? (req.body?.fileName || parsed.fileName) : ''
    });
    res.json({
        url,
        expiresIn: publicUrl ? 0 : 60 * 60
    });
}));

router.post('/delete', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    const key = String(req.body?.key || '').trim();
    const parsed = parseObjectKey(key);
    if (!parsed) {
        throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    }
    await authorizeAttachmentParent(userRecord, parsed, 'update');
    if (req.body?.storage === 'database' || !isR2Configured()) {
        await db('attachment_blobs').where({ key }).del();
        await db('attachment_upload_chunks').where({ object_key: key }).del();
        await db('attachment_upload_sessions').where({ object_key: key }).del();
        res.json({ ok: true });
        return;
    }
    await deleteObject(key);
    res.json({ ok: true });
}));

export default router;
