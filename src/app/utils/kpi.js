import {
  compareDateOnlyStrings,
  getHondurasTodayStr,
  isDateBeforeDateString,
  normalizeDateOnlyString,
} from "./date.js";

export const KPI_MIN_TASKS = 5;
export const KPI_COMPLETION_WEIGHT = 70;
export const KPI_ON_TIME_WEIGHT = 30;

const ACCOUNT_HIERARCHY_WEIGHTS = { p1: 4, p2: 3, p3: 2, p4: 1 };
const getAccountTaskWeight = (task = {}) => {
  const hierarchy =
    task.hierarchy ||
    (task.priority === "urgente"
      ? "p1"
      : task.priority === "recurrente"
        ? "p3"
        : "p2");
  return ACCOUNT_HIERARCHY_WEIGHTS[hierarchy] || ACCOUNT_HIERARCHY_WEIGHTS.p2;
};
export const getKpiTaskWeight = (task = {}) => getAccountTaskWeight(task);

export const calculateKpiScore = ({
  weightedTotal = 0,
  weightedCompleted = 0,
  onTimeWeight = 0,
} = {}) => {
  if (!Number.isFinite(weightedTotal) || weightedTotal <= 0) return 0;
  const completed = Number.isFinite(weightedCompleted)
    ? Math.max(0, Math.min(weightedTotal, weightedCompleted))
    : 0;
  const onTime = Number.isFinite(onTimeWeight)
    ? Math.max(0, Math.min(completed, onTimeWeight))
    : 0;
  // Both components use the assigned workload. A late delivery adds credit
  // without reducing the credit already earned by other deliveries.
  return Math.round(
    (completed * KPI_COMPLETION_WEIGHT + onTime * KPI_ON_TIME_WEIGHT) /
      weightedTotal,
  );
};

export const getKpiPeriod = (today = getHondurasTodayStr()) => {
  const end = normalizeDateOnlyString(today) || getHondurasTodayStr();
  return { start: `${end.slice(0, 7)}-01`, end };
};

export const isWorkflowCompleted = (status = "") =>
  ["aprobado_internamente", "aprobado", "publicado", "cerrado"].includes(
    status,
  );

export const normalizeEditingWorkflowStatus = (status = "") =>
  status === "correccion" ? "en_edicion" : status;

export const isEditingDelivered = (task = {}) =>
  Boolean(task.editorCompletedAt) ||
  ["revision_interna", "aprobado", "publicado"].includes(
    normalizeEditingWorkflowStatus(task.status),
  );

export const isEditingActionable = (task = {}) =>
  ["editar", "en_edicion"].includes(
    normalizeEditingWorkflowStatus(task.status),
  );

const getHondurasDateFromIso = (value = "") => {
  if (!value) return "";
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsedDate);
  const getPart = (type) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

export const getMeasuredCompletionIso = (task = {}) => {
  const candidates = [
    task.completedAt,
    task.statusTimestamps?.aprobado_internamente,
    task.statusTimestamps?.aprobado,
    task.statusTimestamps?.publicado,
    task.statusTimestamps?.cerrado,
    task.internallyApprovedAt,
    task.approvedAt,
    task.publishedAt,
    task.closedAt,
  ].filter((value) => Number.isFinite(Date.parse(value)));

  return candidates.sort((left, right) => Date.parse(left) - Date.parse(right))[0] || "";
};

const isEditorKpiCompleted = (task = {}) =>
  ["revision_interna", "aprobado", "publicado"].includes(
    normalizeEditingWorkflowStatus(task.status),
  );

export const getKpiTaskMeta = (task = {}, kind) => {
  kind = task._taskType ? (task._taskType === "editingTask"
    ? "editor"
    : task._taskType === "managementTask" ? "management" : "manager") : kind || "manager";
  const completed =
    kind === "editor"
      ? isEditorKpiCompleted(task)
      : kind === "management"
        ? task.status === "cerrado"
      : ["aprobado_internamente", "publicado"].includes(task.status);
  const ownerAtCompletion = kind === "editor"
    ? task.editorOwnerAtCompletionId : task.ownerAtCompletionId;
  const assigneeAtCompletion = kind === "editor"
    ? task.editorAssigneeUserAtCompletionId : task.assigneeUserAtCompletionId;
  const assigneesAtCompletion = kind === "editor"
    ? task.editorAssigneesAtCompletion : task.assigneesAtCompletion;
  const hasHistoricalOwners = completed && (
    ownerAtCompletion || assigneeAtCompletion || Array.isArray(assigneesAtCompletion)
  );
  const ownerIds = [...new Set((hasHistoricalOwners
    ? [ownerAtCompletion, assigneeAtCompletion,
        ...(Array.isArray(assigneesAtCompletion) ? assigneesAtCompletion : [])]
    : [task.contextId, task.assigneeUserId, ...(Array.isArray(task.assignees) ? task.assignees : [])]
  ).filter(Boolean))];
  const dueDate = normalizeDateOnlyString(
    completed
      ? kind === "editor"
        ? task.editorDueDateAtCompletion || task.date
        : task.dueDateAtCompletion || task.date
      : task.date,
  );
  const completionCandidates = kind === "editor"
    ? [task.editorCompletedAt, task.statusTimestamps?.revision_interna,
        getMeasuredCompletionIso(task)]
    : [getMeasuredCompletionIso(task)];
  const completionIso = completed
    ? completionCandidates.filter((value) => Number.isFinite(Date.parse(value)))
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0] || ""
    : "";
  return { kind, completed, ownerIds, dueDate, completionIso };
};

// Capture all responsible people before a completed task is edited/reassigned.
// Existing historical owners take precedence over the current assignment.
export const getKpiHistoryPatch = (task = {}, kind) => {
  const meta = getKpiTaskMeta(task, kind);
  if (!meta.completed) return {};
  kind = meta.kind;
  const editor = kind === "editor";
  const ownerKey = editor ? "editorOwnerAtCompletionId" : "ownerAtCompletionId";
  const userKey = editor ? "editorAssigneeUserAtCompletionId" : "assigneeUserAtCompletionId";
  const assigneesKey = editor ? "editorAssigneesAtCompletion" : "assigneesAtCompletion";
  const dateKey = editor ? "editorDueDateAtCompletion" : "dueDateAtCompletion";
  const patch = {};
  if (!task[ownerKey]) patch[ownerKey] = task.contextId || task.assigneeUserId || "";
  if (!task[dateKey]) patch[dateKey] = normalizeDateOnlyString(task.date);
  if (!task[ownerKey] || task[ownerKey] === task.contextId) {
    if (!Object.hasOwn(task, userKey)) patch[userKey] = task.assigneeUserId || "";
    if (!Array.isArray(task[assigneesKey])) {
      patch[assigneesKey] = Array.isArray(task.assignees)
        ? task.assignees.filter(Boolean) : [task.contextId].filter(Boolean);
    }
  }
  return patch;
};

export const STAGE_DEFINITIONS = {
  editing: [
    { id: "editar", label: "Espera para editar", owner: "Editor" },
    { id: "en_edicion", label: "Producción del editor", owner: "Editor" },
    { id: "revision_interna", label: "Revisión de account", owner: "Account" },
    { id: "aprobado", label: "Aprobación", owner: "Account" },
    { id: "publicado", label: "Publicado", owner: "Account" },
  ],
  account: [
    { id: "por_disenar", label: "Elaboración de account", owner: "Account" },
    { id: "aprobacion_interna", label: "Revisión del supervisor", owner: "Supervisor" },
    { id: "aprobado_internamente", label: "Aprobación", owner: "Account" },
    { id: "publicado", label: "Publicado", owner: "Account" },
  ],
  management: [
    { id: "pendiente", label: "Espera de inicio", owner: "Gestión" },
    { id: "en_proceso", label: "Elaboración", owner: "Gestión" },
    { id: "en_espera", label: "En espera", owner: "Gestión" },
    { id: "cerrado", label: "Cerrado", owner: "Gestión" },
  ],
};

const stageStatusId = (status = "") => (
  normalizeEditingWorkflowStatus(String(status || "").trim())
);

export const sanitizeStageLog = (value) => {
  if (!Array.isArray(value)) return [];
  return value.slice(-80).map((entry) => ({
    status: stageStatusId(entry?.status).slice(0, 40),
    enteredAt: String(entry?.enteredAt || "").slice(0, 40),
    leftAt: String(entry?.leftAt || "").slice(0, 40),
    durationMs: Math.max(0, Number(entry?.durationMs) || 0),
    actorId: String(entry?.actorId || "").slice(0, 120),
    closedById: String(entry?.closedById || "").slice(0, 120),
  })).filter((entry) => entry.status && entry.enteredAt);
};

const stageDurationMs = (enteredAt, leftAt) => {
  const start = Date.parse(enteredAt);
  const end = Date.parse(leftAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return end - start;
};

export const appendStageTransition = ({
  task = {},
  nextStatus = "",
  stamp = new Date().toISOString(),
  actorUserId = "",
} = {}) => {
  const status = stageStatusId(nextStatus);
  const stageLog = sanitizeStageLog(task.stageLog);
  if (!status) return { stageLog };
  const previousStatus = stageStatusId(task.status);
  const closeOpenStage = () => {
    let openIndex = -1;
    for (let index = stageLog.length - 1; index >= 0; index -= 1) {
      if (stageLog[index].status === previousStatus && !stageLog[index].leftAt) {
        openIndex = index;
        break;
      }
    }
    if (openIndex >= 0) {
      const enteredAt = stageLog[openIndex].enteredAt;
      stageLog[openIndex] = {
        ...stageLog[openIndex],
        leftAt: stamp,
        durationMs: stageDurationMs(enteredAt, stamp),
        closedById: String(actorUserId || ""),
      };
      return;
    }
    if (!previousStatus || previousStatus === status) return;
    const enteredAt = task.lastStatusChangedAt
      || task.statusTimestamps?.[task.status]
      || task.statusTimestamps?.[previousStatus]
      || task.createdAt
      || stamp;
    stageLog.push({
      status: previousStatus,
      enteredAt,
      leftAt: stamp,
      durationMs: stageDurationMs(enteredAt, stamp),
      actorId: "",
      closedById: String(actorUserId || ""),
    });
  };
  if (previousStatus && previousStatus !== status) closeOpenStage();
  const hasOpenCurrent = stageLog.some((entry) => entry.status === status && !entry.leftAt);
  if (!hasOpenCurrent) {
    stageLog.push({
      status,
      enteredAt: stamp,
      leftAt: "",
      durationMs: 0,
      actorId: String(actorUserId || ""),
    });
  }
  return { stageLog: stageLog.slice(-80) };
};

const inferStageLog = (task = {}, now = Date.now()) => {
  const points = Object.entries(task.statusTimestamps || {})
    .map(([status, enteredAt]) => ({ status: stageStatusId(status), enteredAt: String(enteredAt || "") }))
    .filter((entry) => entry.status && Number.isFinite(Date.parse(entry.enteredAt)))
    .sort((left, right) => Date.parse(left.enteredAt) - Date.parse(right.enteredAt));
  const current = stageStatusId(task.status);
  if (current && !points.some((entry) => entry.status === current)) {
    points.push({
      status: current,
      enteredAt: task.lastStatusChangedAt || task.createdAt || new Date(now).toISOString(),
    });
    points.sort((left, right) => Date.parse(left.enteredAt) - Date.parse(right.enteredAt));
  }
  return points.map((entry, index) => {
    const next = points[index + 1];
    const isCurrent = !next && entry.status === current;
    const leftAt = isCurrent ? "" : (next?.enteredAt || "");
    return {
      ...entry,
      leftAt,
      durationMs: leftAt ? stageDurationMs(entry.enteredAt, leftAt) : 0,
      actorId: "",
      closedById: "",
    };
  });
};

export const buildStageTimeline = (task = {}, workflow = "account", now = Date.now()) => {
  const recorded = sanitizeStageLog(task.stageLog);
  const estimated = recorded.length === 0;
  const entries = estimated ? inferStageLog(task, now) : recorded;
  const definitions = STAGE_DEFINITIONS[workflow] || [];
  const stages = definitions.map((stage) => {
    const visits = entries.filter((entry) => entry.status === stage.id);
    let totalMs = 0;
    let open = false;
    let lastActorId = "";
    visits.forEach((entry) => {
      if (entry.closedById || entry.actorId) lastActorId = entry.closedById || entry.actorId;
      if (entry.leftAt) {
        totalMs += Number(entry.durationMs) || stageDurationMs(entry.enteredAt, entry.leftAt);
        return;
      }
      open = true;
      const entered = Date.parse(entry.enteredAt);
      if (Number.isFinite(entered)) totalMs += Math.max(0, now - entered);
    });
    return { ...stage, totalMs, open, visits: visits.length, lastActorId };
  }).filter((stage) => stage.visits > 0);
  return { estimated, entries, stages };
};

export const getStatusTimestampPatch = (
  task = {},
  newStatus = "",
  stamp = new Date().toISOString(),
  actorUserId = "",
  workflowType = "",
) => {
  const statusTimestamps = {
    ...(task.statusTimestamps || {}),
    [newStatus]: task.statusTimestamps?.[newStatus] || stamp,
  };
  const patch = { lastStatusChangedAt: stamp, statusTimestamps };
  if (newStatus === "publicado" && !task.publishedAt) patch.publishedAt = stamp;
  if (newStatus === "aprobado" && !task.approvedAt) patch.approvedAt = stamp;
  if (newStatus === "aprobado_internamente" && !task.internallyApprovedAt)
    patch.internallyApprovedAt = stamp;
  if (newStatus === "cerrado" && !task.closedAt) patch.closedAt = stamp;
  if (isWorkflowCompleted(newStatus) && !task.completedAt) {
    patch.completedAt = stamp;
    patch.completedByUserId = actorUserId || "";
    patch.ownerAtCompletionId = task.contextId || task.assigneeUserId || "";
    patch.dueDateAtCompletion = normalizeDateOnlyString(task.date);
  }
  Object.assign(patch, getKpiHistoryPatch(
    { ...task, status: newStatus },
    workflowType === "editing" ? "editor" : workflowType === "management" ? "management" : "manager",
  ));
  if (workflowType === "editing") {
    const previousEditingStatus = normalizeEditingWorkflowStatus(task.status);
    const nextEditingStatus = normalizeEditingWorkflowStatus(newStatus);
    const isEditorDelivery = [
      "revision_interna",
      "aprobado",
      "publicado",
    ].includes(nextEditingStatus);
    const isReturnedToEditing =
      ["revision_interna", "aprobado", "publicado"].includes(
        previousEditingStatus,
      ) && ["editar", "en_edicion"].includes(nextEditingStatus);

    if (isEditorDelivery && !task.editorCompletedAt) {
      patch.editorCompletedAt = stamp;
      patch.editorCompletedByUserId = actorUserId || "";
      patch.editorOwnerAtCompletionId =
        task.contextId || task.assigneeUserId || "";
      patch.editorAssigneeUserAtCompletionId = task.assigneeUserId || "";
      patch.editorAssigneesAtCompletion = Array.isArray(task.assignees)
        ? task.assignees.filter(Boolean)
        : [];
      patch.editorDueDateAtCompletion = normalizeDateOnlyString(task.date);
    }
    if (isReturnedToEditing && task.editorCompletedAt) {
      patch.editorReworkCount = Number(task.editorReworkCount || 0) + 1;
      patch.lastEditorReworkAt = stamp;
    }
  }
  Object.assign(patch, appendStageTransition({
    task,
    nextStatus: newStatus,
    stamp,
    actorUserId,
  }));
  return patch;
};

const getProfileIds = (profile = {}) => [
  profile.id, profile.userId, profile.assigneeUserId,
  profile.linkedManagerId, profile.linkedEditorId,
].filter(Boolean);

// Active work only. Queue statuses (editar, pendiente, en_espera) are waiting
// time and do not count against the person who has not started yet.
const PACE_STAGE_OWNERS = {
  en_edicion: "editor",
  por_disenar: "owner",
  en_proceso: "owner",
  revision_interna: "account",
  aprobacion_interna: "account",
  aprobado: "account",
  aprobado_internamente: "owner",
};
const KPI_PACE_BLEND = 0.25;
const PACE_FULL_RATIO = 0.4;
const PACE_ZERO_RATIO = 1.2;

const paceOwnerIds = (task, stageId) => {
  if (PACE_STAGE_OWNERS[stageId] === "editor") {
    return [
      task.contextId, task.assigneeUserId, task.editorOwnerAtCompletionId,
      ...(Array.isArray(task.assignees) ? task.assignees : []),
    ];
  }
  if (PACE_STAGE_OWNERS[stageId] === "account") return [task.accountId];
  return [
    task.contextId, task.assigneeUserId, task.ownerAtCompletionId,
    ...(Array.isArray(task.assignees) ? task.assignees : []),
  ];
};

const dueWindowEndMs = (dueDate) => Date.parse(`${dueDate}T23:59:59.999-06:00`);

export const getTaskStagePace = (task = {}, personIds = [], now = Date.now()) => {
  const ids = new Set(personIds.map((id) => String(id)).filter(Boolean));
  if (!ids.size || !Array.isArray(task.stageLog) || !task.stageLog.length) return null;
  let workMs = 0;
  for (const entry of task.stageLog) {
    const stageId = entry?.status === "correccion" ? "en_edicion" : entry?.status;
    if (!PACE_STAGE_OWNERS[stageId]) continue;
    const closedBy = entry.closedById ? String(entry.closedById) : "";
    const belongs = closedBy
      ? ids.has(closedBy)
      : paceOwnerIds(task, stageId).some((id) => id && ids.has(String(id)));
    if (!belongs) continue;
    const entered = Date.parse(entry.enteredAt || "");
    const left = entry.leftAt ? Date.parse(entry.leftAt) : now;
    if (!Number.isFinite(entered) || !Number.isFinite(left) || left <= entered) continue;
    workMs += left - entered;
  }
  if (workMs <= 0) return null;
  const dueDate = normalizeDateOnlyString(task.date);
  const started = Date.parse(task.createdAt || task.stageLog[0]?.enteredAt || "");
  const budgetMs = dueDate && Number.isFinite(started) ? dueWindowEndMs(dueDate) - started : 0;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return null;
  const ratio = workMs / budgetMs;
  const pace = Math.round(Math.max(0, Math.min(100,
    ((PACE_ZERO_RATIO - ratio) / (PACE_ZERO_RATIO - PACE_FULL_RATIO)) * 100,
  )));
  return { workMs, budgetMs, pace };
};

export const summarizePace = (tasks = [], personIds = [], now = Date.now()) => {
  const samples = [];
  tasks.forEach((task) => {
    const sample = getTaskStagePace(task, personIds, now);
    if (!sample) return;
    samples.push({ weight: getKpiTaskWeight(task), pace: sample.pace });
  });
  if (!samples.length) return null;
  const weight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  return {
    paceScore: Math.round(samples.reduce((sum, sample) => sum + sample.pace * sample.weight, 0) / weight),
    paceTaskCount: samples.length,
  };
};

export const applyPaceToScore = (score = 0, paceScore = null) => {
  if (!Number.isFinite(paceScore)) return score;
  const pace = Math.max(0, Math.min(100, paceScore));
  return Math.round(score * (1 - KPI_PACE_BLEND) + pace * KPI_PACE_BLEND);
};

const withPace = (summary, tasks, personIds, period, now) => {
  const pace = summarizePace(
    tasks.filter((task) => isInPeriod(getKpiTaskMeta(task), period)),
    personIds,
    now,
  );
  return {
    ...summary,
    paceScore: pace?.paceScore ?? null,
    paceTaskCount: pace?.paceTaskCount || 0,
    score: applyPaceToScore(summary.score, pace?.paceScore ?? null),
  };
};

const isInPeriod = (meta, period) => Boolean(
  meta.dueDate && period?.start && period?.end &&
  compareDateOnlyStrings(meta.dueDate, period.start) >= 0 &&
  compareDateOnlyStrings(meta.dueDate, period.end) <= 0,
);

const summarizeKpiEntries = (entries, today) => {
  const completedEntries = entries.filter(({ meta }) => meta.completed);
  const measuredEntries = completedEntries.filter(({ meta }) => meta.completionIso);
  const onTimeEntries = measuredEntries.filter(({ meta }) =>
    compareDateOnlyStrings(getHondurasDateFromIso(meta.completionIso), meta.dueDate) <= 0,
  );
  const sumWeight = (items) => items.reduce((sum, { task }) => sum + getKpiTaskWeight(task), 0);
  const weightedTotal = sumWeight(entries);
  const weightedCompleted = sumWeight(completedEntries);
  const measuredWeight = sumWeight(measuredEntries);
  const onTimeWeight = sumWeight(onTimeEntries);
  const total = entries.length;
  const completed = completedEntries.length;
  const missingTimingCount = completed - measuredEntries.length;
  const completionPercent = weightedTotal ? Math.round(weightedCompleted / weightedTotal * 100) : 0;
  return {
    monthlyTasks: entries.map(({ task }) => task),
    completedTasks: completedEntries.map(({ task }) => task),
    total, completed, delivered: completed, pending: total - completed,
    overdueTasks: entries.filter(({ meta }) =>
      !meta.completed && isDateBeforeDateString(meta.dueDate, today),
    ).length,
    weightedTotal, weightedCompleted, measuredWeight, onTimeWeight,
    completionPercent, deliveryPerformance: completionPercent,
    measuredCompletionCount: measuredEntries.length,
    missingTimingCount,
    onTimeCount: onTimeEntries.length,
    onTimePercent: measuredWeight ? Math.round(onTimeWeight / measuredWeight * 100) : null,
    qualified: total >= KPI_MIN_TASKS && missingTimingCount === 0,
    provisionalReason: missingTimingCount > 0
      ? `${missingTimingCount} entregas sin fecha`
      : total < KPI_MIN_TASKS ? `${total}/${KPI_MIN_TASKS} tareas` : "",
    score: calculateKpiScore({ weightedTotal, weightedCompleted, onTimeWeight }),
  };
};

export const buildPersonalKpiSnapshot = (
  tasks = [], period = getKpiPeriod(), profile, today = getHondurasTodayStr(),
  now = Date.now(),
) => {
  const profileIds = profile ? new Set(getProfileIds(profile)) : null;
  const entries = tasks.map((task) => ({ task, meta: getKpiTaskMeta(task) }))
    .filter(({ meta }) => isInPeriod(meta, period) &&
      (!profileIds || meta.ownerIds.some((id) => profileIds.has(id))));
  return withPace(summarizeKpiEntries(entries, today), tasks, getProfileIds(profile), period, now);
};

export const buildTeamKpiStats = ({
  people = [], tasks = [], kind = "manager", period = getKpiPeriod(),
  today = getHondurasTodayStr(),
  now = Date.now(),
} = {}) => {
  const peopleByAlias = new Map();
  people.forEach((person) => getProfileIds(person).forEach((alias) => {
    if (!peopleByAlias.has(alias)) peopleByAlias.set(alias, new Set());
    peopleByAlias.get(alias).add(person.id);
  }));
  const tasksByOwner = new Map();
  tasks.forEach((task) => {
    const meta = getKpiTaskMeta(task, kind);
    if (!isInPeriod(meta, period)) return;
    const owners = new Set(meta.ownerIds.flatMap((id) => [...(peopleByAlias.get(id) || [])]));
    owners.forEach((id) => {
      if (!tasksByOwner.has(id)) tasksByOwner.set(id, []);
      tasksByOwner.get(id).push({ task, meta });
    });
  });
  return people.map((person) => {
    const entries = tasksByOwner.get(person.id) || [];
    return {
      ...person,
      ...withPace(summarizeKpiEntries(entries, today), tasks, getProfileIds(person), period, now),
      kind,
      kindLabel: kind === "editor" ? "Editor" : "Account Manager",
      published: entries.filter(({ task }) => task.status === "publicado").length,
      approved: entries.filter(({ task, meta }) => meta.kind === "editor"
        ? ["aprobado", "publicado"].includes(normalizeEditingWorkflowStatus(task.status))
          : ["aprobado_internamente", "publicado"].includes(task.status),
      ).length,
    };
  });
};

export const buildManagerKpiStats = ({
  managers = [], clients = [], accountTasks = [], rankingPeriod = getKpiPeriod(),
  today = getHondurasTodayStr(),
} = {}) => {
  const inactiveClientIds = new Set(
    clients.filter((client) => client.isActive === false).map((client) => client.id),
  );
  const stats = buildTeamKpiStats({
    people: managers,
    tasks: accountTasks.filter((task) =>
      !inactiveClientIds.has(task.clientId) || getKpiTaskMeta(task, "manager").completed,
    ),
    kind: "manager", period: rankingPeriod, today,
  }).map((item) => ({
    ...item,
    totalTasks: item.total,
    completedTasks: item.completed,
    totalClients: new Set(item.monthlyTasks.map((task) => task.clientId).filter(Boolean)).size,
    pendingTasks: item.pending,
    weightedCompletionPercent: item.completionPercent,
  }));
  const qualifiedStats = stats.filter((item) => item.qualified);
  const loadReference = Math.max(1,
    ...(qualifiedStats.length ? qualifiedStats : stats).map((item) => item.weightedCompleted),
  );
  return stats.map((item) => ({
    ...item,
    loadPercent: Math.min(100, Math.round(item.weightedCompleted / loadReference * 100)),
  })).sort((left, right) =>
    Number(right.qualified) - Number(left.qualified) ||
    right.score - left.score || right.weightedCompleted - left.weightedCompleted ||
        (right.onTimePercent ?? -1) - (left.onTimePercent ?? -1) ||
        String(left.name || "").localeCompare(String(right.name || "")),
    );
};

const EDITING_DUE_BUCKET = { overdue: 0, today: 1, tomorrow: 2, later: 3 };
const EDITING_HIERARCHY_ORDER = { p1: 0, p2: 1, p3: 2, p4: 3 };
const EDITING_PRIORITY_ORDER = {
  urgente: 0,
  alta: 1,
  normal: 2,
  recurrente: 3,
  baja: 4,
};

const getDueBucket = (date = "", today = getHondurasTodayStr()) => {
  const normalizedDate = normalizeDateOnlyString(date);
  if (!normalizedDate) return EDITING_DUE_BUCKET.later;
  const delta = compareDateOnlyStrings(normalizedDate, today);
  if (delta < 0) return EDITING_DUE_BUCKET.overdue;
  if (delta === 0) return EDITING_DUE_BUCKET.today;

  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return normalizedDate === tomorrow.toISOString().slice(0, 10)
    ? EDITING_DUE_BUCKET.tomorrow
    : EDITING_DUE_BUCKET.later;
};

export const rankPendingEditingTasks = (
  tasks = [],
  today = getHondurasTodayStr(),
) =>
  tasks
    .filter(isEditingActionable)
    .sort((left, right) => {
      const leftHierarchy =
        left.hierarchy ||
        (left.priority === "urgente"
          ? "p1"
          : left.priority === "recurrente"
            ? "p3"
            : "p2");
      const rightHierarchy =
        right.hierarchy ||
        (right.priority === "urgente"
          ? "p1"
          : right.priority === "recurrente"
            ? "p3"
            : "p2");

      return (
        getDueBucket(left.date, today) - getDueBucket(right.date, today) ||
        (EDITING_HIERARCHY_ORDER[leftHierarchy] ?? 9) -
          (EDITING_HIERARCHY_ORDER[rightHierarchy] ?? 9) ||
        (EDITING_PRIORITY_ORDER[left.priority] ?? 9) -
          (EDITING_PRIORITY_ORDER[right.priority] ?? 9) ||
        String(left.date || "9999-12-31").localeCompare(
          String(right.date || "9999-12-31"),
        ) ||
        String(left.title || "").localeCompare(String(right.title || ""))
      );
    });
