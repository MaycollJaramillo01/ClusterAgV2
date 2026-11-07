export const BUSINESS_TIMEZONE = 'America/Tegucigalpa';

const TIME_ONLY_PATTERN = /^(\d{1,2}):(\d{2})$/;

export const getViewerTimeZone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || BUSINESS_TIMEZONE;
    } catch {
        return BUSINESS_TIMEZONE;
    }
};

const getZonedParts = (dateObj, timeZone = BUSINESS_TIMEZONE) => {
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (Number.isNaN(date.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date);
        const get = (type) => parts.find((part) => part.type === type)?.value || '';
        return {
            year: get('year'),
            month: get('month'),
            day: get('day'),
            hour: get('hour'),
            minute: get('minute'),
            second: get('second')
        };
    } catch {
        return null;
    }
};

export const getZonedDateString = (dateObj = new Date(), timeZone = BUSINESS_TIMEZONE) => {
    const parts = getZonedParts(dateObj, timeZone);
    if (!parts?.year) return '';
    return `${parts.year}-${parts.month}-${parts.day}`;
};

export const getZonedTimeString = (dateObj = new Date(), timeZone = BUSINESS_TIMEZONE) => {
    const parts = getZonedParts(dateObj, timeZone);
    if (!parts?.hour) return '';
    return `${parts.hour}:${parts.minute}`;
};

export const getHondurasDateString = (dateObj = new Date()) => (
    getZonedDateString(dateObj, BUSINESS_TIMEZONE)
);

export const getHondurasTodayStr = () => getHondurasDateString(new Date());

export const getViewerTodayStr = () => getZonedDateString(new Date(), getViewerTimeZone());

export const getViewerTimeZoneLabel = (timeZone = getViewerTimeZone()) => {
    try {
        const parts = new Intl.DateTimeFormat('es-HN', {
            timeZone,
            timeZoneName: 'short'
        }).formatToParts(new Date());
        return parts.find((part) => part.type === 'timeZoneName')?.value || timeZone;
    } catch {
        return timeZone;
    }
};

const normalizeTimeOnly = (value = '') => {
    const match = String(value || '').trim().match(TIME_ONLY_PATTERN);
    if (!match) return '';
    const hours = match[1].padStart(2, '0');
    const minutes = match[2];
    if (Number(hours) > 23 || Number(minutes) > 59) return '';
    return `${hours}:${minutes}`;
};

/**
 * Interpreta date+time guardados como hora de negocio (Honduras) y
 * devuelve el instante absoluto.
 */
export const parseBusinessDueMs = (date = '', time = '17:00') => {
    const normalizedDate = normalizeDateOnlyString(date);
    const normalizedTime = normalizeTimeOnly(time) || '17:00';
    if (!normalizedDate) return null;
    const iso = `${normalizedDate}T${normalizedTime}:00-06:00`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
};

const zonedWallTimeToUtcMs = (date = '', time = '00:00', timeZone = BUSINESS_TIMEZONE) => {
    const normalizedDate = normalizeDateOnlyString(date);
    const normalizedTime = normalizeTimeOnly(time) || '00:00';
    if (!normalizedDate) return null;
    const [year, month, day] = normalizedDate.split('-').map(Number);
    const [hour, minute] = normalizedTime.split(':').map(Number);
    let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 3; i += 1) {
        const parts = getZonedParts(new Date(guess), timeZone);
        if (!parts) return null;
        const asUtc = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            Number(parts.hour),
            Number(parts.minute),
            Number(parts.second || 0)
        );
        const diff = Date.UTC(year, month - 1, day, hour, minute, 0) - asUtc;
        guess += diff;
        if (diff === 0) break;
    }
    return guess;
};

/** Convierte date/time locales del usuario a date/time canónicos (Honduras). */
export const viewerDueToStored = ({
    date = '',
    time = '',
    timeZone = getViewerTimeZone()
} = {}) => {
    const normalizedDate = normalizeDateOnlyString(date);
    if (!normalizedDate) return { date: '', time: '' };
    const normalizedTime = normalizeTimeOnly(time);
    if (!normalizedTime) {
        return { date: normalizedDate, time: '' };
    }
    const ms = zonedWallTimeToUtcMs(normalizedDate, normalizedTime, timeZone);
    if (!Number.isFinite(ms)) return { date: normalizedDate, time: normalizedTime };
    return {
        date: getZonedDateString(new Date(ms), BUSINESS_TIMEZONE),
        time: getZonedTimeString(new Date(ms), BUSINESS_TIMEZONE)
    };
};

/** Convierte date/time canónicos (Honduras) a la zona del usuario que abre la tarea. */
export const storedDueToViewer = ({
    date = '',
    time = '',
    timeZone = getViewerTimeZone(),
    fallbackTime = '17:00'
} = {}) => {
    const normalizedDate = normalizeDateOnlyString(date);
    if (!normalizedDate) return { date: '', time: '' };
    const normalizedTime = normalizeTimeOnly(time);
    if (!normalizedTime) {
        return { date: normalizedDate, time: '' };
    }
    const ms = parseBusinessDueMs(normalizedDate, normalizedTime || fallbackTime);
    if (!Number.isFinite(ms)) {
        return { date: normalizedDate, time: normalizedTime };
    }
    return {
        date: getZonedDateString(new Date(ms), timeZone),
        time: getZonedTimeString(new Date(ms), timeZone)
    };
};

export const formatTaskDueLabel = ({
    date = '',
    time = '',
    timeZone = getViewerTimeZone(),
    includeTimeZone = false
} = {}) => {
    const local = storedDueToViewer({ date, time, timeZone });
    if (!local.date) return '';
    const [year, month, day] = local.date.split('-').map(Number);
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const dateLabel = `${day} ${months[month - 1] || ''}`;
    if (!local.time) return dateLabel;
    const zone = includeTimeZone ? ` ${getViewerTimeZoneLabel(timeZone)}` : '';
    return `${dateLabel} · ${local.time}${zone}`;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const padDateSegment = (value) => String(value).padStart(2, '0');

export const normalizeDateOnlyString = (value = '') => {
    if (typeof value !== 'string') return '';
    const trimmedValue = value.trim();
    if (!trimmedValue) return '';

    const directMatch = trimmedValue.match(DATE_ONLY_PATTERN);
    if (directMatch) {
        const [, year, month, day] = directMatch;
        return `${year}-${padDateSegment(month)}-${padDateSegment(day)}`;
    }

    const parsedDate = new Date(trimmedValue);
    if (Number.isNaN(parsedDate.getTime())) return '';
    return getHondurasDateString(parsedDate);
};

export const compareDateOnlyStrings = (leftValue = '', rightValue = '') => {
    const normalizedLeft = normalizeDateOnlyString(leftValue);
    const normalizedRight = normalizeDateOnlyString(rightValue);
    if (!normalizedLeft && !normalizedRight) return 0;
    if (!normalizedLeft) return -1;
    if (!normalizedRight) return 1;
    return normalizedLeft.localeCompare(normalizedRight);
};

export const isDateBeforeDateString = (value = '', referenceValue = getHondurasTodayStr()) => (
    compareDateOnlyStrings(value, referenceValue) < 0
);

const dateOnlyStringToUtcTimestamp = (value = '') => {
    const normalizedValue = normalizeDateOnlyString(value);
    if (!normalizedValue) return null;
    const [year, month, day] = normalizedValue.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
};

export const getDateOnlyDiffDays = (leftValue = '', rightValue = getHondurasTodayStr()) => {
    const leftTimestamp = dateOnlyStringToUtcTimestamp(leftValue);
    const rightTimestamp = dateOnlyStringToUtcTimestamp(rightValue);
    if (leftTimestamp === null || rightTimestamp === null) return 0;
    return Math.round((leftTimestamp - rightTimestamp) / 86400000);
};

export const resolveStoredTaskRoomDate = (currentDate = '', savedAt = '', today = getHondurasTodayStr()) => {
    const normalizedToday = normalizeDateOnlyString(today) || getHondurasTodayStr();
    const normalizedCurrentDate = normalizeDateOnlyString(currentDate) || normalizedToday;
    const normalizedSavedAt = normalizeDateOnlyString(savedAt);
    const isPastDate = compareDateOnlyStrings(normalizedCurrentDate, normalizedToday) < 0;
    const isStaleState = !normalizedSavedAt || compareDateOnlyStrings(normalizedSavedAt, normalizedToday) < 0;
    return isPastDate && isStaleState ? normalizedToday : normalizedCurrentDate;
};

const WEEKEND_UTC_DAYS = new Set([0, 6]);

const LAST_24H_MS = 24 * 60 * 60 * 1000;

export const formatHondurasDateTime = (dateObj = new Date()) => {
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (Number.isNaN(date.getTime())) return '';
    try {
        return new Intl.DateTimeFormat('es-HN', {
            timeZone: 'America/Tegucigalpa',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    } catch {
        return date.toISOString();
    }
};

export const getLast24HoursRange = (now = new Date()) => {
    const end = now instanceof Date ? now : new Date(now);
    const start = new Date(end.getTime() - LAST_24H_MS);
    return {
        fromDate: getHondurasDateString(start),
        toDate: getHondurasDateString(end),
        startMs: start.getTime(),
        endMs: end.getTime(),
        periodLabel: `${formatHondurasDateTime(start)} – ${formatHondurasDateTime(end)} (Honduras)`
    };
};

export const shiftDateOnlyString = (value = '', amount = 0) => {
    const normalized = normalizeDateOnlyString(value);
    const steps = Number(amount);
    if (!normalized || !Number.isFinite(steps) || steps === 0) return normalized;
    const [year, month, day] = normalized.split('-').map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    cursor.setUTCDate(cursor.getUTCDate() + Math.trunc(steps));
    return cursor.toISOString().slice(0, 10);
};

export const isWeekendDate = (value = '') => {
    const normalized = normalizeDateOnlyString(value);
    if (!normalized) return false;
    const [year, month, day] = normalized.split('-').map(Number);
    return WEEKEND_UTC_DAYS.has(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
};

export const getWeekStartDate = (value = getHondurasTodayStr()) => {
    const normalized = normalizeDateOnlyString(value) || getHondurasTodayStr();
    const [year, month, day] = normalized.split('-').map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    const mondayOffset = (cursor.getUTCDay() + 6) % 7;
    cursor.setUTCDate(cursor.getUTCDate() - mondayOffset);
    return cursor.toISOString().slice(0, 10);
};

export const addBusinessDays = (value = '', amount = 0) => {
    const normalized = normalizeDateOnlyString(value);
    const steps = Number(amount);
    if (!normalized || !Number.isFinite(steps) || steps === 0) return normalized;
    const [year, month, day] = normalized.split('-').map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    const direction = steps > 0 ? 1 : -1;
    let remaining = Math.abs(Math.trunc(steps));
    while (remaining > 0) {
        cursor.setUTCDate(cursor.getUTCDate() + direction);
        if (!WEEKEND_UTC_DAYS.has(cursor.getUTCDay())) remaining -= 1;
    }
    return cursor.toISOString().slice(0, 10);
};
