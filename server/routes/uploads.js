import express from 'express';
import { createRecordId } from '../lib/crypto.js';
import { asyncHandler, createHttpError } from '../lib/http.js';
import {
    ALLOWED_ATTACHMENT_TYPES,
    CHAT_ATTACHMENT_COLLECTION,
    TASK_ATTACHMENT_COLLECTIONS,
    buildObjectKey,
    inferContentType,
    parseObjectKey
} from '../lib/attachments.js';
import { getCollectionPermission, hasPermission } from '../lib/permissions.js';
import { getRecord } from '../lib/records.js';
import { deleteObject, getR2MaxFileBytes, isR2Configured, publicObjectUrl, signDownloadUrl, signUploadUrl } from '../lib/r2.js';
import { requireAuthenticatedUser } from '../lib/sessions.js';

const router = express.Router();

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

router.get('/status', asyncHandler(async (req, res) => {
    requireAuthenticatedUser(req);
    res.json({
        r2: isR2Configured(),
        maxBytes: isR2Configured() ? getR2MaxFileBytes() : 3 * 1024 * 1024
    });
}));

router.post('/sign', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    if (!isR2Configured()) {
        throw createHttpError(503, 'El almacenamiento de archivos no esta configurado.', 'uploads/not-configured');
    }

    const collectionName = String(req.body?.collectionName || '').trim();
    const parentId = resolveParentId(collectionName, req.body);
    const fileName = String(req.body?.fileName || '').trim();
    const contentType = inferContentType(req.body?.fileName, req.body?.contentType);
    const size = Number(req.body?.size);

    if (!parentId || !fileName) {
        throw createHttpError(400, 'Faltan datos del archivo.', 'uploads/invalid-request');
    }
    if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
        throw createHttpError(400, 'El tipo de archivo no esta permitido.', 'attachment/type-denied');
    }
    if (!Number.isFinite(size) || size <= 0 || size > getR2MaxFileBytes()) {
        throw createHttpError(413, `El archivo supera el limite de ${Math.round(getR2MaxFileBytes() / (1024 * 1024))} MB.`, 'attachment/too-large');
    }

    if (collectionName === CHAT_ATTACHMENT_COLLECTION) {
        requireChatPermission(userRecord, 'update');
        const client = await getRecord({ collectionName: 'clients', recordId: parentId });
        if (!client) {
            throw createHttpError(404, 'El cliente no existe.', 'document/not-found');
        }
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
    const uploadUrl = await signUploadUrl({ key, contentType });
    res.json({
        uploadUrl,
        key,
        attachmentId,
        publicUrl: publicObjectUrl(key),
        headers: { 'Content-Type': contentType }
    });
}));

router.post('/url', asyncHandler(async (req, res) => {
    const userRecord = requireAuthenticatedUser(req);
    if (!isR2Configured()) {
        throw createHttpError(503, 'El almacenamiento de archivos no esta configurado.', 'uploads/not-configured');
    }

    const key = String(req.body?.key || '').trim();
    const parsed = parseObjectKey(key);
    if (!parsed) {
        throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    }
    if (parsed.kind === 'chat') {
        requireChatPermission(userRecord, 'read');
        const client = await getRecord({ collectionName: 'clients', recordId: parsed.clientId });
        if (!client) {
            throw createHttpError(404, 'El cliente no existe.', 'document/not-found');
        }
    } else {
        requireTaskPermission(userRecord, parsed.collectionName, 'read');
        const task = await getRecord({ collectionName: parsed.collectionName, recordId: parsed.taskId });
        if (!task) {
            throw createHttpError(404, 'La tarea no existe.', 'document/not-found');
        }
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
    if (!isR2Configured()) {
        throw createHttpError(503, 'El almacenamiento de archivos no esta configurado.', 'uploads/not-configured');
    }

    const key = String(req.body?.key || '').trim();
    const parsed = parseObjectKey(key);
    if (!parsed) {
        throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    }
    if (parsed.kind === 'chat') {
        requireChatPermission(userRecord, 'update');
    } else {
        requireTaskPermission(userRecord, parsed.collectionName, 'update');
    }
    await deleteObject(key);
    res.json({ ok: true });
}));

export default router;
