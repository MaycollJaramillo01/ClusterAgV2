import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { createHttpError } from './http.js';
import { sanitizeFileName } from './attachments.js';

let cachedClient = null;

export const isR2Configured = () => Boolean(
    env.r2.accountId
    && env.r2.accessKeyId
    && env.r2.secretAccessKey
    && env.r2.bucket
);

export const getR2MaxFileBytes = () => env.r2.maxFileBytes;

const getClient = () => {
    if (!isR2Configured()) {
        throw createHttpError(503, 'El almacenamiento de archivos no esta configurado.', 'uploads/not-configured');
    }
    if (!cachedClient) {
        cachedClient = new S3Client({
            region: 'auto',
            endpoint: env.r2.endpoint,
            credentials: {
                accessKeyId: env.r2.accessKeyId,
                secretAccessKey: env.r2.secretAccessKey
            }
        });
    }
    return cachedClient;
};

export const publicObjectUrl = (key) => {
    if (!env.r2.publicBaseUrl || !key) return '';
    return `${env.r2.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
};

export const signUploadUrl = async ({ key, contentType }) => {
    const command = new PutObjectCommand({
        Bucket: env.r2.bucket,
        Key: key,
        ContentType: contentType
    });
    return getSignedUrl(getClient(), command, { expiresIn: env.r2.signTtlSeconds });
};

export const signDownloadUrl = async ({ key, downloadName = '' }) => {
    const command = new GetObjectCommand({
        Bucket: env.r2.bucket,
        Key: key,
        ...(downloadName
            ? { ResponseContentDisposition: `attachment; filename="${sanitizeFileName(downloadName)}"` }
            : {})
    });
    return getSignedUrl(getClient(), command, { expiresIn: env.r2.downloadTtlSeconds });
};

export const deleteObject = async (key) => {
    await getClient().send(new DeleteObjectCommand({
        Bucket: env.r2.bucket,
        Key: key
    }));
};
