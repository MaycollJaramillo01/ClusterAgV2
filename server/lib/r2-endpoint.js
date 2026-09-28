const ACCOUNT_ID_PATTERN = /^[a-f0-9]{16,}$/i;

const trimSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

export const resolveR2Endpoint = (accountId = '', endpoint = '') => {
    const account = String(accountId || '').trim();
    const raw = trimSlash(endpoint);
    const fromAccount = account ? `https://${account}.r2.cloudflarestorage.com` : '';
    if (!raw) return fromAccount;
    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            if (ACCOUNT_ID_PATTERN.test(url.hostname)) {
                return fromAccount || `https://${url.hostname}.r2.cloudflarestorage.com`;
            }
            return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
        } catch {
            return raw;
        }
    }
    if (raw === account || ACCOUNT_ID_PATTERN.test(raw)) {
        return fromAccount || `https://${raw}.r2.cloudflarestorage.com`;
    }
    return `https://${raw}`;
};

export const resolveR2PublicBaseUrl = (value = '') => {
    const raw = trimSlash(value);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
};
