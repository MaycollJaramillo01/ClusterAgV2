import {
  addBusinessDays,
  compareDateOnlyStrings,
  normalizeDateOnlyString,
} from "./date.js";

export const RECURRENCE_FREQUENCIES = [
  { id: "none", label: "No se repite", cap: 1 },
  { id: "daily", label: "Cada día", cap: 30 },
  { id: "weekdays", label: "Días hábiles", cap: 30 },
  { id: "weekly", label: "Cada semana", cap: 26 },
  { id: "biweekly", label: "Cada 2 semanas", cap: 26 },
  { id: "monthly", label: "Cada mes", cap: 12 },
];

export const getRecurrenceMeta = (frequency = "none") =>
  RECURRENCE_FREQUENCIES.find((item) => item.id === frequency) || RECURRENCE_FREQUENCIES[0];

const addCalendarDays = (value, amount) => {
  const normalized = normalizeDateOnlyString(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + Number(amount || 0));
  return cursor.toISOString().slice(0, 10);
};

const addCalendarMonths = (value, amount) => {
  const normalized = normalizeDateOnlyString(value);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  cursor.setUTCMonth(cursor.getUTCMonth() + Number(amount || 0));
  const lastDay = new Date(Date.UTC(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  cursor.setUTCDate(Math.min(day, lastDay));
  return cursor.toISOString().slice(0, 10);
};

export const nextRecurrenceDate = (value, frequency) => {
  if (frequency === "daily") return addCalendarDays(value, 1);
  if (frequency === "weekdays") return addBusinessDays(value, 1);
  if (frequency === "weekly") return addCalendarDays(value, 7);
  if (frequency === "biweekly") return addCalendarDays(value, 14);
  if (frequency === "monthly") return addCalendarMonths(value, 1);
  return "";
};

export const normalizeRecurrence = (value = {}) => {
  const frequency = getRecurrenceMeta(value?.frequency).id;
  const until = normalizeDateOnlyString(value?.until || "");
  if (frequency === "none") return { frequency: "none", until: "" };
  return { frequency, until };
};

export const buildRecurrenceDates = ({
  startDate = "",
  frequency = "none",
  until = "",
  maxCount,
} = {}) => {
  const start = normalizeDateOnlyString(startDate);
  if (!start) return [];
  const meta = getRecurrenceMeta(frequency);
  if (meta.id === "none") return [start];
  const cap = Math.max(1, Math.min(Number(maxCount) || meta.cap, meta.cap));
  const limit = normalizeDateOnlyString(until);
  const dates = [start];
  let cursor = start;
  while (dates.length < cap) {
    const next = nextRecurrenceDate(cursor, meta.id);
    if (!next || next === cursor) break;
    if (limit && compareDateOnlyStrings(next, limit) > 0) break;
    dates.push(next);
    cursor = next;
  }
  return dates;
};

export const createRecurrenceSeriesId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const buildRecurrencePayload = ({ date = "", recurrence } = {}) => {
  const normalized = normalizeRecurrence(recurrence);
  const dates = buildRecurrenceDates({
    startDate: date,
    frequency: normalized.frequency,
    until: normalized.until,
  });
  if (dates.length <= 1) {
    return {
      dates: dates.length ? dates : [normalizeDateOnlyString(date)].filter(Boolean),
      recurrence: null,
    };
  }
  const seriesId = createRecurrenceSeriesId();
  return {
    dates,
    recurrence: {
      frequency: normalized.frequency,
      until: normalized.until,
      seriesId,
      total: dates.length,
    },
  };
};

export const isRecurringTask = (task = {}) => Boolean(
  task.recurrenceSeriesId
  || (task.recurrence && task.recurrence.frequency && task.recurrence.frequency !== "none"),
);
