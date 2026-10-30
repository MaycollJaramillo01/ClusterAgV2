import {
  addBusinessDays,
  compareDateOnlyStrings,
  getHondurasDateString,
  getHondurasTodayStr,
  getWeekStartDate,
  isDateBeforeDateString,
  isWeekendDate,
  normalizeDateOnlyString,
  shiftDateOnlyString,
} from "./date.js";
import { getKpiTaskMeta } from "./kpi.js";

export const ROLE_PRIORITY = {
  super_admin: 500,
  operations: 400,
  management: 350,
  manager: 300,
  editor: 250,
  viewer: 100,
};

export const EDITOR_DAILY_NEW_TARGET = 5;
export const ACCOUNT_WORK_WEEK_END_TIME = "18:00";
export const EDITOR_DAILY_PENALTY_MAX = 20;
export const ACCOUNT_PACE_PENALTY_CAP = 30;
export const MAX_QUOTA_PENALTY = 40;
export const HONDURAS_OFFSET = "-06:00";

export const getRolePriority = (role = "") =>
  ROLE_PRIORITY[role] || ROLE_PRIORITY.viewer;

export const isEditorCorrectionTask = (task = {}) => {
  if (task?.isCorrection === true) return true;
  if (Number(task?.editorReworkCount) > 0) return true;
  return String(task?.status || "").toLowerCase() === "correccion";
};

const uniqueIds = (profile = {}) =>
  [...new Set([
    profile.id,
    profile.userId,
    profile.assigneeUserId,
    profile.linkedManagerId,
    profile.linkedEditorId,
  ].filter(Boolean))];

const ownsTask = (task, profile, kind) => {
  const ids = new Set(uniqueIds(profile));
  if (!ids.size) return false;
  return getKpiTaskMeta(task, kind).ownerIds.some((id) => ids.has(id));
};

const completionDay = (meta = {}) => {
  if (meta.completionIso && Number.isFinite(Date.parse(meta.completionIso))) {
    return getHondurasDateString(new Date(meta.completionIso));
  }
  return meta.completed ? normalizeDateOnlyString(meta.dueDate) : "";
};

const clampPercent = (value) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

const hondurasMs = (date, time) => {
  const day = normalizeDateOnlyString(date);
  if (!day || !/^\d{2}:\d{2}$/.test(time || "")) return NaN;
  return Date.parse(`${day}T${time}:00${HONDURAS_OFFSET}`);
};

export const getElapsedWorkWeekPercent = ({
  today = getHondurasTodayStr(),
  nowMs = Date.now(),
} = {}) => {
  const weekStart = getWeekStartDate(today);
  const friday = shiftDateOnlyString(weekStart, 4);
  const startMs = hondurasMs(weekStart, "00:00");
  const endMs = hondurasMs(friday, ACCOUNT_WORK_WEEK_END_TIME);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  if (nowMs <= startMs) return 0;
  if (nowMs >= endMs) return 100;
  return clampPercent(Math.round(((nowMs - startMs) / (endMs - startMs)) * 100));
};

export const evaluateEditorDailyQuota = ({
  tasks = [],
  profile = {},
  today = getHondurasTodayStr(),
  day = addBusinessDays(today, -1),
} = {}) => {
  const targetDate = normalizeDateOnlyString(day);
  const empty = {
    applies: false,
    missed: false,
    day: targetDate,
    assigned: 0,
    completed: 0,
    target: 0,
    shortfall: 0,
    penalty: 0,
  };
  if (!targetDate || isWeekendDate(targetDate)) return empty;
  const owned = tasks.filter((task) => ownsTask(task, profile, "editor"));
  const assigned = owned.filter((task) =>
    normalizeDateOnlyString(task.date) === targetDate && !isEditorCorrectionTask(task),
  ).length;
  const completed = owned.filter((task) => {
    if (isEditorCorrectionTask(task)) return false;
    const meta = getKpiTaskMeta(task, "editor");
    return meta.completed && completionDay(meta) === targetDate;
  }).length;
  if (assigned <= 0 && completed <= 0) return empty;
  const target = assigned > 0
    ? (assigned >= EDITOR_DAILY_NEW_TARGET ? EDITOR_DAILY_NEW_TARGET : assigned)
    : EDITOR_DAILY_NEW_TARGET;
  const shortfall = Math.max(0, target - completed);
  const missed = shortfall > 0;
  const penalty = missed && target > 0
    ? Math.round((shortfall / target) * EDITOR_DAILY_PENALTY_MAX)
    : 0;
  return {
    applies: true,
    missed,
    day: targetDate,
    assigned,
    completed,
    target,
    shortfall,
    penalty,
  };
};

export const evaluateAccountWeeklyPace = ({
  tasks = [],
  profile = {},
  today = getHondurasTodayStr(),
  nowMs = Date.now(),
} = {}) => {
  const weekStart = getWeekStartDate(today);
  const weekEnd = shiftDateOnlyString(weekStart, 6);
  const owned = tasks.filter((task) => ownsTask(task, profile, "manager"));
  const weekly = owned.filter((task) => {
    const due = normalizeDateOnlyString(task.date);
    return due
      && compareDateOnlyStrings(due, weekStart) >= 0
      && compareDateOnlyStrings(due, weekEnd) <= 0;
  });
  const assigned = weekly.length;
  const completed = weekly.filter((task) => getKpiTaskMeta(task, "manager").completed).length;
  const elapsedPercent = getElapsedWorkWeekPercent({ today, nowMs });
  const progressPercent = assigned ? Math.round((completed / assigned) * 100) : 0;
  const gap = assigned > 0 ? Math.max(0, elapsedPercent - progressPercent) : 0;
  const behind = assigned > 0 && gap > 0;
  return {
    applies: assigned > 0,
    behind,
    weekStart,
    weekEnd,
    assigned,
    completed,
    elapsedPercent,
    progressPercent,
    gap,
    penalty: behind ? Math.min(ACCOUNT_PACE_PENALTY_CAP, gap) : 0,
  };
};

const DEFAULT_DUE_TIME_BY_TASK_TYPE = {
  accountTask: ACCOUNT_WORK_WEEK_END_TIME,
  editingTask: ACCOUNT_WORK_WEEK_END_TIME,
  managementTask: ACCOUNT_WORK_WEEK_END_TIME,
  event: ACCOUNT_WORK_WEEK_END_TIME,
};

const taskKindOf = (task = {}) =>
  task._taskType === "editingTask"
    ? "editor"
    : task._taskType === "managementTask"
      ? "management"
      : "manager";

const tagTasks = (tasks = [], taskType) =>
  (Array.isArray(tasks) ? tasks : []).map((task) =>
    task?._taskType ? task : { ...task, _taskType: taskType },
  );

const isTaskPastDue = (task, meta, today, nowMs) => {
  if (meta.completed || !meta.dueDate) return false;
  if (isDateBeforeDateString(meta.dueDate, today)) return true;
  if (meta.dueDate !== today) return false;
  const time = /^\d{2}:\d{2}$/.test(task.time || "")
    ? task.time
    : DEFAULT_DUE_TIME_BY_TASK_TYPE[task._taskType] || "";
  const dueMs = hondurasMs(meta.dueDate, time);
  return Number.isFinite(dueMs) && nowMs > dueMs;
};

export const listOpenOverdueTasks = ({
  tasks = [],
  profile = {},
  today = getHondurasTodayStr(),
  nowMs = Date.now(),
} = {}) =>
  tasks.filter((task) => {
    const kind = taskKindOf(task);
    if (profile && uniqueIds(profile).length && !ownsTask(task, profile, kind)) return false;
    return isTaskPastDue(task, getKpiTaskMeta(task, kind), today, nowMs);
  });

export const countOpenOverdueTasks = (options = {}) =>
  listOpenOverdueTasks(options).length;

export const applyPerformancePenalty = (score = 0, penalty = 0) =>
  Math.max(0, Math.min(100, Math.round(Number(score) || 0) - Math.max(0, Math.round(Number(penalty) || 0))));

/**
 * Superiores jerarquicos de un rol: usuarios activos con prioridad estrictamente
 * mayor. Los Account Managers (rol `manager`) solo supervisan lo que toca a sus
 * clientes: si se pasa `managerKeys` (ids de los Account Managers responsables
 * del cliente), un `manager` solo cuenta cuando coincide con alguno de ellos.
 */
export const getSupervisorUsers = ({
  role = "",
  users = [],
  managerKeys = null,
  excludeIds = [],
} = {}) => {
  const level = getRolePriority(role);
  const excluded = new Set((excludeIds || []).filter(Boolean).map(String));
  const scoped = managerKeys instanceof Set ? managerKeys : null;
  return (Array.isArray(users) ? users : []).filter((user) => {
    if (!user || user.isActive === false) return false;
    if (excluded.has(String(user.id))) return false;
    if (getRolePriority(user.role) <= level) return false;
    if (user.role === "manager" && scoped) {
      return [user.id, user.userId, user.linkedManagerId]
        .filter(Boolean)
        .some((id) => scoped.has(String(id)));
    }
    return true;
  });
};

export const buildComplianceSnapshot = ({
  profile = {},
  accountTasks = [],
  editingTasks = [],
  managementTasks = [],
  today = getHondurasTodayStr(),
  nowMs = Date.now(),
} = {}) => {
  const account = tagTasks(accountTasks, "accountTask");
  const editing = tagTasks(editingTasks, "editingTask");
  const management = tagTasks(managementTasks, "managementTask");
  const role = profile.role || "";
  const looksEditor = Boolean(profile.linkedEditorId) || role === "editor";
  const looksManager = Boolean(profile.linkedManagerId) || role === "manager";
  const editorDaily = looksEditor
    ? evaluateEditorDailyQuota({ tasks: editing, profile, today })
    : evaluateEditorDailyQuota({ tasks: [], profile, today });
  const accountWeekly = looksManager
    ? evaluateAccountWeeklyPace({ tasks: account, profile, today, nowMs })
    : evaluateAccountWeeklyPace({ tasks: [], profile, today, nowMs });
  const overdueTasks = listOpenOverdueTasks({
    tasks: [...account, ...editing, ...management],
    profile,
    today,
    nowMs,
  });
  const overdueCount = overdueTasks.length;
  const quotaPenalty = Math.min(
    MAX_QUOTA_PENALTY,
    (editorDaily.missed ? editorDaily.penalty : 0) + (accountWeekly.behind ? accountWeekly.penalty : 0),
  );
  const alerts = [];
  if (overdueCount > 0) {
    alerts.push({
      id: "overdue",
      type: "overdue",
      title: "Tareas vencidas",
      message: overdueCount === 1
        ? "Tienes 1 tarea vencida. El incumplimiento sigue activo hasta que la completes."
        : `Tienes ${overdueCount} tareas vencidas. El incumplimiento sigue activo hasta que las completes.`,
    });
  }
  if (editorDaily.applies && editorDaily.missed) {
    alerts.push({
      id: "editor-daily",
      type: "editor-daily",
      title: "Meta diaria de edición",
      message: `No cumpliste con la meta diaria por lo cual eso está afectando tu rendimiento en el sistema. Completaste ${editorDaily.completed} de ${editorDaily.target} piezas nuevas el ${editorDaily.day}. Penalización: −${editorDaily.penalty} pts.`,
    });
  }
  if (accountWeekly.applies && accountWeekly.behind) {
    alerts.push({
      id: "account-pace",
      type: "account-pace",
      title: "Ritmo semanal de Account Manager",
      message: `Ha transcurrido el ${accountWeekly.elapsedPercent}% de la semana laborable y solo llevas el ${accountWeekly.progressPercent}% de tus publicaciones (${accountWeekly.completed} de ${accountWeekly.assigned}). Penalización: −${accountWeekly.penalty} pts.`,
    });
  }
  return {
    overdueCount,
    overdueTasks,
    editorDaily,
    accountWeekly,
    quotaPenalty,
    alerts,
    isAlerting: alerts.length > 0,
  };
};

export const decorateKpiWithCompliance = (kpi = {}, compliance = {}) => ({
  ...kpi,
  compliance,
  quotaPenalty: compliance.quotaPenalty || 0,
  baseScore: kpi.score,
  score: applyPerformancePenalty(kpi.score, compliance.quotaPenalty || 0),
});

