import { apiFetch } from './backend-api.js';

const EMBEDDED_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;

export const TASK_UPLOAD_COLLECTIONS = {
    accountTask: 'account_tasks',
    editingTask: 'editing',
    managementTask: 'management_tasks'
};

let cachedStatus = null;

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
        return cachedStatus;
    } catch {
        cachedStatus = { r2: false, maxBytes: EMBEDDED_UPLOAD_MAX_BYTES };
        return cachedStatus;
    }
};

export const formatUploadLimit = (bytes) => {
    const mega = Number(bytes) / (1024 * 1024);
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

export const putFileToSignedUrl = (uploadUrl, file, headers = {}, onProgress) => (
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        Object.entries(headers).forEach(([name, value]) => {
            if (value) xhr.setRequestHeader(name, value);
        });
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable || typeof onProgress !== 'function') return;
            onProgress(Math.round((event.loaded / event.total) * 100));
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

export const resolveAttachmentUrl = async (attachment, { download = false } = {}) => {
    if (attachment?.data) return attachment.data;
    if (!attachment?.key) return attachment?.url || '';
    const payload = await apiFetch('/api/uploads/url', {
        method: 'POST',
        body: JSON.stringify({
            key: attachment.key,
            fileName: attachment.name,
            download
        })
    });
    return payload?.url || '';
};

export const deleteStoredAttachment = async (key) => {
    if (!key) return;
    try {
        await apiFetch('/api/uploads/delete', {
            method: 'POST',
            body: JSON.stringify({ key })
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
