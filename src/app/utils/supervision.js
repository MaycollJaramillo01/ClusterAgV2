export const SUPERVISION_QUOTA_CATEGORIES = [
  { id: "videos", label: "Videos" },
  { id: "publications", label: "Publicaciones" },
  { id: "advertising", label: "Pautas publicitarias" },
];

export const resolveClientPlanAssignments = (clients = [], plans = []) => {
  const plansById = new Map(plans.map((plan) => [String(plan.id), plan]));
  return clients.map((client) => {
    const plan = plansById.get(String(client.planId || ""));
    return plan
      ? {
          ...client,
          package: plan.name,
          planName: plan.name,
          monthlyQuota: { ...(plan.monthlyQuota || {}) },
        }
      : client;
  });
};

export const getTaskApprovalTimestamp = (task = {}) => {
  const timestamps = task.statusTimestamps || {};
  const candidates = [
    task.approvedAt,
    timestamps.aprobado,
    timestamps.publicado,
    task.publishedAt,
    task.status === "aprobado" || task.status === "publicado"
      ? task.updatedAt || task.createdAt
      : "",
  ];
  return candidates.find((value) => Number.isFinite(Date.parse(value))) || "";
};

const makeUsageBucket = (quota = 0) => ({
  quota: Number.isFinite(Number(quota)) && Number(quota) > 0 ? Number(quota) : 0,
  units: 0,
  taskCount: 0,
  percentage: 0,
});

export const buildClientQuotaUsage = (clients = [], tasks = [], period = "") => {
  const targetPeriod = period || new Date().toISOString().slice(0, 7);
  const result = new Map(
    clients.map((client) => [
      String(client.id),
      Object.fromEntries(
        SUPERVISION_QUOTA_CATEGORIES.map(({ id }) => [
          id,
          makeUsageBucket(client.monthlyQuota?.[id]),
        ]),
      ),
    ]),
  );

  for (const task of tasks) {
    const clientId = String(task.clientId || "");
    const clientUsage = result.get(clientId);
    const approvedAt = getTaskApprovalTimestamp(task);
    if (!clientUsage || !approvedAt || approvedAt.slice(0, 7) !== targetPeriod) continue;

    const category = SUPERVISION_QUOTA_CATEGORIES.some(({ id }) => id === task.quotaCategory)
      ? task.quotaCategory
      : "videos";
    const bucket = clientUsage[category];
    const weight = Number(task.quotaPercent ?? 100);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    bucket.units += weight / 100;
    bucket.taskCount += 1;
  }

  for (const categories of result.values()) {
    for (const usage of Object.values(categories)) {
      usage.percentage = usage.quota > 0
        ? Number(((usage.units / usage.quota) * 100).toFixed(2))
        : 0;
    }
  }
  return result;
};
