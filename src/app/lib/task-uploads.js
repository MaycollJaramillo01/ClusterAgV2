import { apiFetch, buildApiUrl } from './backend-api.js';

const EMBEDDED_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
export const DEFAULT_TASK_UPLOAD_MAX_BYTES = 1_000_000_000;
const DATABASE_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

export const TASK_UPLOAD_COLLECTIONS = {
    accountTask: 'account_tasks',
    editingTask: 'editing',
    managementTask: 'management_tasks'
};

export const MAX_TASK_ATTACHMENTS = 10;

let cachedStatus = null;

const signedUrlCache = new Map();
let remotePublicBaseUrl = '';

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

export const inferFileType = (file) => {
    const declared = String(file?.type || '').trim().toLowerCase();
    if (declared) return declared;
    const ext = String(file?.name || '').split('.').pop()?.toLowerCase();
    return EXTENSION_TYPES[ext] || '';
};

export const getEmbeddedUploadMaxBytes = () => EMBEDDED_UPLOAD_MAX_BYTES;

export const fetchUploadStatus = async () => {
    if (cachedStatus) return cachedStatus;
    try {
        cachedStatus = await apiFetch('/api/uploads/status');
        remotePublicBaseUrl = String(cachedStatus?.publicBaseUrl || '').replace(/\/+$/, '');
        return cachedStatus;
    } catch {
        cachedStatus = { r2: false, storage: 'database', maxBytes: DEFAULT_TASK_UPLOAD_MAX_BYTES, taskMaxBytes: DEFAULT_TASK_UPLOAD_MAX_BYTES, embeddedMaxBytes: EMBEDDED_UPLOAD_MAX_BYTES, retentionDays: 0 };
        return cachedStatus;
    }
};

export const formatUploadLimit = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    const giga = value / 1_000_000_000;
    if (giga >= 1) return `${giga % 1 === 0 ? giga : giga.toFixed(1)} GB`;
    const mega = value / 1_000_000;
    if (mega >= 10) return `${Math.round(mega)} MB`;
    return `${mega.toFixed(1)} MB`;
};

export const hasFileDrag = (event) => (
    Array.from(event?.dataTransfer?.types || []).includes('Files')
);

export const filesFromDrop = (event) => Array.from(event?.dataTransfer?.files || []).filter(Boolean);

export const signStoredUpload = ({ collectionName, parentId, taskId, clientId, file }) => (
    apiFetch('/api/uploads/sign', {
        method: 'POST',
        body: JSON.stringify({
            collectionName,
            taskId: taskId || (collectionName === 'client_chats' ? undefined : parentId),
            clientId: clientId || (collectionName === 'client_chats' ? parentId : undefined),
            fileName: file.name,
            contentType: inferFileType(file),
            size: file.size
        })
    })
);

export const signTaskUpload = ({ collectionName, taskId, file }) => (
    signStoredUpload({ collectionName, taskId, file })
);

const putSingleFile = (uploadUrl, file, headers = {}, onProgress, offset = 0, total = file.size, chunked = false) => (
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.withCredentials = chunked;
        Object.entries(headers).forEach(([name, value]) => {
            if (value) xhr.setRequestHeader(name, value);
        });
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || typeof onProgress !== 'function') return;
            onProgress(Math.round(((offset + event.loaded) / total) * 100));
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
                return;
            }
            const error = new Error('No se pudo subir el archivo al almacenamiento.');
            error.code = 'uploads/put-failed';
            error.status = xhr.status;
            reject(error);
        };
        xhr.onerror = () => {
            const error = new Error('No se pudo conectar con el almacenamiento.');
            error.code = 'uploads/network';
            reject(error);
        };
        xhr.send(file);
    })
);

export const putFileToSignedUrl = async (uploadUrl, file, headers = {}, onProgress) => {
    const parsedUrl = new URL(uploadUrl, window.location.href);
    if (parsedUrl.searchParams.get('mode') !== 'chunked') {
        await putSingleFile(uploadUrl, file, headers, onProgress);
        return;
    }
    const totalParts = Number(parsedUrl.searchParams.get('parts'));
    if (!Number.isInteger(totalParts) || totalParts < 1
        || totalParts !== Math.ceil(file.size / DATABASE_UPLOAD_CHUNK_BYTES)) {
        throw new Error('La sesión de carga no coincide con el archivo seleccionado.');
    }
    for (let part = 0; part < totalParts; part += 1) {
        const start = part * DATABASE_UPLOAD_CHUNK_BYTES;
        const end = Math.min(file.size, start + DATABASE_UPLOAD_CHUNK_BYTES);
        const partUrl = new URL(parsedUrl.toString());
        partUrl.searchParams.set('part', String(part));
        await putSingleFile(partUrl.toString(), file.slice(start, end), headers, onProgress, start, file.size, true);
    }
};

export const attachmentMediaUrl = (attachment, { download = false } = {}) => {
    if (attachment?.data) return attachment.data;
    if (attachment?.localPreview) return attachment.localPreview;
    if (!attachment?.key) return attachment?.url || '';
    if (attachment.storage === 'r2') {
        if (attachment.url) return attachment.url;
        if (remotePublicBaseUrl && !download) return `${remotePublicBaseUrl}/${attachment.key}`;
        return '';
    }
    const query = new URLSearchParams({ key: attachment.key });
    if (download) query.set('download', '1');
    return buildApiUrl(`/api/uploads/blob?${query.toString()}`);
};

export const resolveAttachmentUrl = async (attachment, { download = false } = {}) => {
    const direct = attachmentMediaUrl(attachment, { download });
    if (direct) return direct;
    if (!attachment?.key) return attachment?.url || '';
    const cacheKey = `${attachment.key}:${download ? '1' : '0'}`;
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const payload = await apiFetch('/api/uploads/url', {
        method: 'POST',
        body: JSON.stringify({
            key: attachment.key,
            fileName: attachment.name,
            storage: attachment.storage,
            download
        })
    });
    const url = payload?.url || '';
    if (url) {
        const expiresIn = Number(payload?.expiresIn);
        const ttl = expiresIn > 0 ? Math.max((expiresIn - 60) * 1000, 30_000) : 10 * 60 * 1000;
        signedUrlCache.set(cacheKey, { url, expiresAt: Date.now() + ttl });
    }
    return url;
};

export const deleteStoredAttachment = async (key, storage = '') => {
    if (!key) return;
    try {
        await apiFetch('/api/uploads/delete', {
            method: 'POST',
            body: JSON.stringify({ key, storage })
        });
    } catch (error) {
        console.warn('[uploads] No se pudo borrar el archivo remoto:', error?.message || error);
    }
};

export const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});
