import { listRecords, upsertRecord } from "./records.js";
import { sendEmail, escapeHtml } from "./email.js";
import { collectReportRecipientEmails } from "./permissions.js";
import {
  buildClientQuotaUsage,
  resolveClientPlanAssignments,
  SUPERVISION_QUOTA_CATEGORIES,
} from "../../src/app/utils/supervision.js";
import { nowIso } from "./time.js";

const TIME_ZONE = "America/Tegucigalpa";

const getDateParts = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { year: get("year"), month: get("month"), day: get("day"), weekday: get("weekday") };
};

const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const getSupervisionReportPeriod = (frequency = "weekly", now = new Date()) => {
  const { year, month, day, weekday } = getDateParts(now);
  const dateKey = `${year}-${month}-${day}`;
  if (frequency === "daily") return { key: dateKey, label: dateKey, due: true };
  if (frequency === "monthly") {
    const previousMonth = new Date(Date.UTC(Number(year), Number(month) - 2, 1));
    const key = previousMonth.toISOString().slice(0, 7);
    return {
      key,
      label: key,
      due: day === "01",
    };
  }
  if (frequency !== "weekly") return { key: "", label: "", due: false };
  const offset = (weekdayIndex[weekday] + 6) % 7;
  const weekStart = new Date(`${dateKey}T12:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - offset);
  const key = weekStart.toISOString().slice(0, 10);
  return { key, label: `Semana del ${key}`, due: weekday === "Mon" };
};

const renderQuotaRow = (client, usage = {}) => SUPERVISION_QUOTA_CATEGORIES.map(({ id, label }) => {
  const item = usage[id] || { quota: 0, units: 0, percentage: 0 };
  const percentage = item.quota ? `${Math.round(item.percentage)}%` : "Sin cuota";
  return `<tr><td>${escapeHtml(client.name || "Cliente")}</td><td>${escapeHtml(client.planName || client.package || "Sin plan")}</td><td>${escapeHtml(label)}</td><td>${item.quota}</td><td>${Number(item.units.toFixed(2))}</td><td>${percentage}</td></tr>`;
}).join("");

export const buildSupervisionReportHtml = ({ clients = [], usageByClient = new Map(), periodLabel = "" } = {}) => {
  const rows = clients.map((client) => renderQuotaRow(
    client,
    usageByClient.get(String(client.id)),
  )).join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#0f172a;">
      <h2>Supervisión de cuotas</h2>
      <p>Periodo: <strong>${escapeHtml(periodLabel)}</strong></p>
      <table style="width:100%;border-collapse:collapse;text-align:left;">
        <thead><tr><th>Cliente</th><th>Plan</th><th>Actividad</th><th>Cuota</th><th>Unidades aprobadas</th><th>Uso</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#64748b;font-size:12px;">Reporte automático de Cluster OS.</p>
    </div>`;
};

export const sendSupervisionReport = async ({ now = new Date() } = {}) => {
  const settings = await (async () => {
    const records = await listRecords({ collectionName: "supervision_settings" });
    return records.find((record) => record.id === "global") || null;
  })();
  if (!settings) return { skipped: "not-configured" };

  const frequency = ["daily", "weekly", "monthly"].includes(settings.frequency)
    ? settings.frequency
    : "weekly";
  const period = getSupervisionReportPeriod(frequency, now);
  const periodToken = `${frequency}:${period.key}`;
  if (!period.due || settings.lastSentPeriod === periodToken) {
    return { skipped: period.due ? "already-sent" : "not-scheduled", period: periodToken };
  }

  const [clients, clientPlans, editingTasks, users] = await Promise.all([
    listRecords({ collectionName: "clients" }),
    listRecords({ collectionName: "client_plans" }),
    listRecords({ collectionName: "editing" }),
    listRecords({ collectionName: "users" }),
  ]);
  const resolvedClients = resolveClientPlanAssignments(clients, clientPlans);
  const recipients = collectReportRecipientEmails({
    users,
    extraEmails: settings.recipients || [],
  });
  if (!recipients.length) return { skipped: "no-recipients", period: periodToken };

  const month = frequency === "monthly"
    ? period.key
    : `${getDateParts(now).year}-${getDateParts(now).month}`;
  const usageByClient = buildClientQuotaUsage(resolvedClients, editingTasks, month);
  await sendEmail({
    to: recipients,
    subject: `Supervisión de cuotas — ${period.label}`,
    html: buildSupervisionReportHtml({ clients: resolvedClients, usageByClient, periodLabel: period.label }),
    logLabel: "supervision-report",
  });
  await upsertRecord({
    collectionName: "supervision_settings",
    recordId: "global",
    merge: true,
    payload: {
      ...settings,
      lastSentPeriod: periodToken,
      lastSentAt: nowIso(),
      updatedAt: nowIso(),
    },
  });
  return { sent: true, recipients: recipients.length, period: periodToken };
};
