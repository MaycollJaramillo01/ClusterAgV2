const DEFAULT_R2_CORS_ORIGINS = [
    'https://clusterag.vercel.app',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://localhost',
    'https://localhost',
    'capacitor://localhost',
    'ionic://localhost'
];

const originFromUrl = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return new URL(raw).origin;
    } catch {
        return raw.replace(/\/+$/, '');
    }
};

export const buildR2CorsOrigins = ({ appBaseUrl = '', extra = [] } = {}) => {
    const origins = new Set(DEFAULT_R2_CORS_ORIGINS);
    const appOrigin = originFromUrl(appBaseUrl);
    if (appOrigin) origins.add(appOrigin);
    (Array.isArray(extra) ? extra : String(extra).split(','))
        .map((item) => originFromUrl(item))
        .filter(Boolean)
        .forEach((origin) => origins.add(origin));
    return [...origins];
};

export const buildR2CorsRules = (origins = buildR2CorsOrigins()) => ([
    {
        AllowedOrigins: origins,
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
        MaxAgeSeconds: 3600
    }
]);
