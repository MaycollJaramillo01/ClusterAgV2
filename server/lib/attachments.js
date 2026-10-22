import { createHttpError } from './http.js';

export const TASK_ATTACHMENT_COLLECTIONS = new Set([
    'account_tasks',
    'editing',
    'management_tasks'
]);
export const CHAT_ATTACHMENT_COLLECTION = 'client_chats';
export const STORED_ATTACHMENT_COLLECTIONS = new Set([
    ...TASK_ATTACHMENT_COLLECTIONS,
    CHAT_ATTACHMENT_COLLECTION
]);

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_EMBEDDED_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const DEFAULT_R2_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
export const DEFAULT_R2_RETENTION_DAYS = 5;

export const ALLOWED_ATTACHMENT_TYPES = new Set([
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'application/pdf',
    'application/zip',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain'
]);

const TASK_KEY_PATTERN = /^tasks\/(account_tasks|editing|management_tasks)\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,119})\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/([^/]{1,180})$/;
const CHAT_KEY_PATTERN = /^chats\/([A-Za-z0-9][A-Za-z0-9_.:-]{0,119})\/([A-Za-z0-9][A-Za-z0-9_-]{0,119})\/([^/]{1,180})$/;

const EXTENSION_TYPES = {
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    webm: 'video/webm',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    zip: 'application/zip',
    csv: 'text/csv',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

export const inferContentType = (fileName = '', declared = '') => {
    const type = String(declared || '').trim().toLowerCase();
    if (ALLOWED_ATTACHMENT_TYPES.has(type)) return type;
    const ext = String(fileName).split('.').pop()?.toLowerCase();
    return EXTENSION_TYPES[ext] || type;
};

export const sanitizeFileName = (name = '') => {
    const base = String(name || 'archivo').split(/[/\\]/).pop().trim().slice(0, 180);
    const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
    return cleaned || 'archivo';
};

export const buildObjectKey = ({
    collectionName,
    parentId,
    taskId,
    clientId,
    attachmentId,
    fileName
}) => {
    const ownerId = parentId || taskId || clientId;
    if (collectionName === CHAT_ATTACHMENT_COLLECTION) {
        return `chats/${ownerId}/${attachmentId}/${sanitizeFileName(fileName)}`;
    }
    return `tasks/${collectionName}/${ownerId}/${attachmentId}/${sanitizeFileName(fileName)}`;
};

export const parseObjectKey = (key = '') => {
    const taskMatch = String(key || '').match(TASK_KEY_PATTERN);
    if (taskMatch) {
        return {
            kind: 'task',
            collectionName: taskMatch[1],
            parentId: taskMatch[2],
            taskId: taskMatch[2],
            attachmentId: taskMatch[3],
            fileName: taskMatch[4]
        };
    }
    const chatMatch = String(key || '').match(CHAT_KEY_PATTERN);
    if (!chatMatch) return null;
    return {
        kind: 'chat',
        collectionName: CHAT_ATTACHMENT_COLLECTION,
        parentId: chatMatch[1],
        clientId: chatMatch[1],
        attachmentId: chatMatch[2],
        fileName: chatMatch[3]
    };
};

export const isStoredAttachment = (attachment) => (
    Boolean(attachment && (attachment.key || attachment.storage === 'r2'))
);

const optionalDuration = (value) => {
    const duration = Number(value);
    return Number.isFinite(duration) && duration >= 0 && duration <= 86_400
        ? { duration }
        : {};
};

const sanitizeEmbeddedAttachment = (attachment, index, totals) => {
    const name = String(attachment.name || `archivo-${index + 1}`).trim().slice(0, 180);
    const type = String(attachment.type || '').trim().toLowerCase();
    const data = String(attachment.data || '');
    if (!name || !ALLOWED_ATTACHMENT_TYPES.has(type)) {
        throw createHttpError(400, 'El tipo de archivo no esta permitido.', 'attachment/type-denied');
    }

    const match = data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match || match[1].toLowerCase() !== type) {
        throw createHttpError(400, 'El contenido del adjunto no es valido.', 'attachment/invalid-data');
    }
    const decoded = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (decoded.length === 0) {
        throw createHttpError(400, 'El adjunto esta vacio.', 'attachment/empty');
    }
    totals.embeddedBytes += decoded.length;
    if (totals.embeddedBytes > MAX_EMBEDDED_ATTACHMENT_BYTES) {
        throw createHttpError(413, 'Los adjuntos superan el limite total de 3 MB.', 'attachment/too-large');
    }

    return {
        id: String(attachment.id || `attachment-${index + 1}`).trim().slice(0, 120),
        name,
        type,
        size: decoded.length,
        data,
        ...optionalDuration(attachment.duration)
    };
};

const sanitizeStoredAttachment = (attachment, index, { collectionName, recordId, clientId } = {}) => {
    if (!STORED_ATTACHMENT_COLLECTIONS.has(collectionName)) {
        throw createHttpError(400, 'Este modulo no admite archivos externos.', 'attachment/storage-denied');
    }
    const name = String(attachment.name || `archivo-${index + 1}`).trim().slice(0, 180);
    const type = String(attachment.type || '').trim().toLowerCase();
    const key = String(attachment.key || '').trim();
    const parsed = parseObjectKey(key);
    const size = Number(attachment.size);
    if (!name || !ALLOWED_ATTACHMENT_TYPES.has(type)) {
        throw createHttpError(400, 'El tipo de archivo no esta permitido.', 'attachment/type-denied');
    }
    if (!parsed) {
        throw createHttpError(400, 'La clave del archivo no es valida.', 'attachment/invalid-key');
    }
    if (parsed.collectionName !== collectionName) {
        throw createHttpError(400, 'El archivo no pertenece a esta coleccion.', 'attachment/key-mismatch');
    }
    if (parsed.kind === 'task' && recordId && parsed.taskId !== String(recordId)) {
        throw createHttpError(400, 'El archivo no pertenece a esta tarea.', 'attachment/key-mismatch');
    }
    if (parsed.kind === 'chat' && clientId && parsed.clientId !== String(clientId)) {
        throw createHttpError(400, 'El archivo no pertenece a este chat.', 'attachment/key-mismatch');
    }
    if (!Number.isFinite(size) || size <= 0 || size > DEFAULT_R2_MAX_FILE_BYTES) {
        throw createHttpError(400, 'El tamano del archivo no es valido.', 'attachment/invalid-size');
    }

    const uploadedBy = String(attachment.uploadedBy || '').trim().slice(0, 120);
    const uploadedAt = String(attachment.uploadedAt || '').trim().slice(0, 40);
    return {
        id: String(attachment.id || parsed.attachmentId || `attachment-${index + 1}`).trim().slice(0, 120),
        name,
        type,
        size,
        key,
        storage: 'r2',
        ...(uploadedBy ? { uploadedBy } : {}),
        ...(uploadedAt ? { uploadedAt } : {}),
        ...optionalDuration(attachment.duration)
    };
};

export const sanitizeAttachments = (value, context = {}) => {
    if (!Array.isArray(value) || value.length > MAX_ATTACHMENT_COUNT) {
        throw createHttpError(400, 'Los adjuntos deben ser una lista de hasta 10 archivos.', 'attachment/invalid-list');
    }

    const totals = { embeddedBytes: 0 };
    return value.map((attachment, index) => {
        if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
            throw createHttpError(400, 'El adjunto no es valido.', 'attachment/invalid');
        }
        if (isStoredAttachment(attachment)) {
            return sanitizeStoredAttachment(attachment, index, context);
        }
        return sanitizeEmbeddedAttachment(attachment, index, totals);
    });
};
