import { getHondurasDateString } from "./date.js";

export const USAGE_VISIT_GAP_MS = 2 * 60 * 1000;

export const USAGE_FEATURES = [
  { id: "dashboard", label: "Panel" },
  { id: "clients", label: "Clientes" },
  { id: "chat", label: "Chat" },
  { id: "team", label: "Equipo" },
  { id: "account-room", label: "Sala de Accounts" },
  { id: "editions", label: "Sala de Edición" },
  { id: "management-room", label: "Sala de Gestión" },
  { id: "calendar", label: "Calendario" },
  { id: "reports", label: "Reportes" },
  { id: "performance", label: "Rendimiento" },
  { id: "podcast", label: "Podcast" },
  { id: "production", label: "Producción" },
  { id: "users", label: "Usuarios" },
];

const FEATURE_IDS = new Set(USAGE_FEATURES.map((feature) => feature.id));

const VIEW_FEATURES = {
  dashboard: "dashboard",
  clients: "clients",
  "client-detail": "clients",
  chat: "chat",
  managers: "team",
  "manager-detail": "team",
  editors: "team",
  "editor-detail": "team",
  "team-usage": "team",
  "account-room": "account-room",
  editions: "editions",
  "management-room": "management-room",
  calendar: "calendar",
  "general-calendar": "calendar",
  reports: "reports",
  performance: "performance",
  podcast: "podcast",
  production: "production",
  "control-center": "users",
};

const COLLECTION_FEATURES = {
  clients: "clients",
  client_chats: "chat",
  chat_groups: "chat",
  team_groups: "chat",
  account_tasks: "account-room",
  editing: "editions",
  management_tasks: "management-room",
  events: "calendar",
  managers: "team",
  editors: "team",
  users: "users",
};

export const featureForView = (view = "") => VIEW_FEATURES[view] || "";

export const featureForCollection = (collectionName = "") => (
  COLLECTION_FEATURES[collectionName] || ""
);

export const featureLabel = (featureId = "") => (
  USAGE_FEATURES.find((feature) => feature.id === featureId)?.label || featureId
);

export const usageWindow = (dayCount = 30, now = new Date()) => {
  const days = Math.min(90, Math.max(1, Math.floor(Number(dayCount) || 30)));
  const end = getHondurasDateString(now);
  const cursor = new Date(`${end}T12:00:00-06:00`);
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));
  const start = getHondurasDateString(cursor);
  const endExclusive = new Date(`${end}T00:00:00-06:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return {
    days,
    start,
    end,
    createdFrom: new Date(`${start}T00:00:00-06:00`).toISOString(),
    createdTo: endExclusive.toISOString(),
  };
};

export const applyUsageVisit = (
  record = {},
  featureId = "",
  nowMs = Date.now(),
  gapMs = USAGE_VISIT_GAP_MS,
) => {
  if (!FEATURE_IDS.has(featureId)) return null;
  const lastMs = Date.parse(record?.lastFeatureAt?.[featureId] || "");
  if (Number.isFinite(lastMs) && nowMs - lastMs < gapMs) return null;
  const current = Math.max(0, Number(record?.visits?.[featureId]) || 0);
  return {
    visits: { ...(record.visits || {}), [featureId]: current + 1 },
    lastFeatureAt: {
      ...(record.lastFeatureAt || {}),
      [featureId]: new Date(nowMs).toISOString(),
    },
  };
};

const blankFeatures = () => Object.fromEntries(
  USAGE_FEATURES.map((feature) => [feature.id, { visits: 0, actions: 0 }]),
);

export const summarizeTeamUsage = ({
  users = [],
  visits = [],
  auditLogs = [],
  start = "",
  end = "",
} = {}) => {
  const rows = new Map();
  const ensure = (userId, seed = {}) => {
    const id = String(userId || "").trim();
    if (!id) return null;
    if (!rows.has(id)) {
      rows.set(id, {
        id,
        name: String(seed.name || "").trim(),
        email: String(seed.email || "").trim(),
        role: String(seed.role || "").trim(),
        visits: 0,
        actions: 0,
        lastAt: "",
        features: blankFeatures(),
      });
    }
    const row = rows.get(id);
    if (!row.name && seed.name) row.name = String(seed.name).trim();
    if (!row.email && seed.email) row.email = String(seed.email).trim();
    if (!row.role && seed.role) row.role = String(seed.role).trim();
    return row;
  };

  users
    .filter((user) => user?.isActive !== false && user?.id)
    .forEach((user) => ensure(user.id, user));

  visits.forEach((day) => {
    const date = String(day?.date || "").slice(0, 10);
    if (!date || (start && date < start) || (end && date > end)) return;
    const row = ensure(day.userId, {});
    if (!row) return;
    Object.entries(day.visits || {}).forEach(([featureId, count]) => {
      const total = Math.max(0, Number(count) || 0);
      if (!FEATURE_IDS.has(featureId) || total <= 0) return;
      row.features[featureId].visits += total;
      row.visits += total;
    });
    const lastAt = String(day.lastAt || "");
    if (lastAt > row.lastAt) row.lastAt = lastAt;
  });

  auditLogs.forEach((log) => {
    const featureId = featureForCollection(log?.entityType);
    if (!featureId) return;
    const createdAt = String(log?.createdAt || "");
    const date = getHondurasDateString(createdAt);
    if (!date || (start && date < start) || (end && date > end)) return;
    const actor = log?.actor || {};
    const row = ensure(actor.uid, actor);
    if (!row) return;
    row.features[featureId].actions += 1;
    row.actions += 1;
    if (createdAt > row.lastAt) row.lastAt = createdAt;
  });

  return [...rows.values()]
    .map((row) => ({
      ...row,
      features: USAGE_FEATURES
        .map((feature) => ({
          id: feature.id,
          label: feature.label,
          visits: row.features[feature.id].visits,
          actions: row.features[feature.id].actions,
        }))
        .filter((feature) => feature.visits > 0 || feature.actions > 0),
    }))
    .sort((left, right) => (
      (right.visits + right.actions) - (left.visits + left.actions)
      || String(left.name || left.email).localeCompare(String(right.name || right.email), "es")
    ));
};

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.split("\"").join("\"\"")}"` : text;
};

export const usageReportCsv = (people = [], { start = "", end = "" } = {}) => {
  const header = [
    "Nombre",
    "Correo",
    "Rol",
    "Visitas",
    "Acciones",
    "Ultima actividad",
    "Funciones",
  ];
  const lines = [
    `Informe de uso del equipo,${csvCell(start)},${csvCell(end)}`,
    header.join(","),
    ...people.map((person) => [
      person.name || "Sin nombre",
      person.email || "",
      person.role || "",
      person.visits || 0,
      person.actions || 0,
      person.lastAt || "",
      person.features
        .map((feature) => {
          const visits = `${feature.visits} ${feature.visits === 1 ? "visita" : "visitas"}`;
          const actions = `${feature.actions} ${feature.actions === 1 ? "accion" : "acciones"}`;
          return `${feature.label}: ${visits}, ${actions}`;
        })
        .join(" | "),
    ].map(csvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}\n`;
};
