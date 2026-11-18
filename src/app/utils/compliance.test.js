import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPerformancePenalty,
  buildComplianceSnapshot,
  countOpenOverdueTasks,
  decorateKpiWithCompliance,
  evaluateAccountWeeklyPace,
  evaluateEditorDailyQuota,
  getElapsedWorkWeekPercent,
  getSupervisorUsers,
  isEditorCorrectionTask,
} from "./compliance.js";
import { getWeekStartDate } from "./date.js";

const editor = { id: "editor-1", linkedEditorId: "editor-1", role: "editor" };
const manager = { id: "manager-1", linkedManagerId: "manager-1", role: "manager" };

test("getWeekStartDate y el porcentaje de semana laborable usan lunes a viernes 18:00", () => {
  assert.equal(getWeekStartDate("2026-10-28"), "2026-10-26");
  const wednesdayNoon = Date.parse("2026-10-28T12:00:00-06:00");
  const elapsed = getElapsedWorkWeekPercent({ today: "2026-10-28", nowMs: wednesdayNoon });
  assert.equal(elapsed, 53);
  assert.equal(getElapsedWorkWeekPercent({
    today: "2026-10-31",
    nowMs: Date.parse("2026-10-31T20:00:00-06:00"),
  }), 100);
});

test("las correcciones no cuentan en la meta diaria de 5 piezas nuevas", () => {
  assert.equal(isEditorCorrectionTask({ status: "correccion" }), true);
  assert.equal(isEditorCorrectionTask({ editorReworkCount: 1, status: "editar" }), true);
  const tasks = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `new-${index}`,
      _taskType: "editingTask",
      contextId: editor.id,
      date: "2026-10-27",
      status: "revision_interna",
      editorCompletedAt: "2026-10-27T18:00:00-06:00",
    })),
    {
      id: "fix",
      _taskType: "editingTask",
      contextId: editor.id,
      date: "2026-10-27",
      status: "correccion",
    },
  ];
  const result = evaluateEditorDailyQuota({
    tasks,
    profile: editor,
    today: "2026-10-28",
  });
  assert.equal(result.applies, true);
  assert.equal(result.target, 4);
  assert.equal(result.completed, 4);
  assert.equal(result.missed, false);
});

test("si hay 5 o más piezas nuevas, la meta queda en 5 y penaliza el faltante", () => {
  const tasks = Array.from({ length: 7 }, (_, index) => ({
    id: `task-${index}`,
    _taskType: "editingTask",
    contextId: editor.id,
    date: "2026-10-27",
    status: index < 3 ? "revision_interna" : "editar",
    editorCompletedAt: index < 3 ? "2026-10-27T16:00:00-06:00" : undefined,
  }));
  const result = evaluateEditorDailyQuota({
    tasks,
    profile: editor,
    today: "2026-10-28",
  });
  assert.equal(result.target, 5);
  assert.equal(result.completed, 3);
  assert.equal(result.shortfall, 2);
  assert.equal(result.missed, true);
  assert.equal(result.penalty, 8);
});

test("Account alerta cuando el avance va por debajo del tiempo transcurrido de la semana", () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    id: `pub-${index}`,
    _taskType: "accountTask",
    contextId: manager.id,
    date: "2026-10-27",
    status: index < 3 ? "publicado" : "por_disenar",
    completedAt: index < 3 ? "2026-10-27T15:00:00-06:00" : undefined,
  }));
  const result = evaluateAccountWeeklyPace({
    tasks,
    profile: manager,
    today: "2026-10-28",
    nowMs: Date.parse("2026-10-28T12:00:00-06:00"),
  });
  assert.equal(result.assigned, 10);
  assert.equal(result.completed, 3);
  assert.equal(result.progressPercent, 30);
  assert.equal(result.elapsedPercent, 53);
  assert.equal(result.behind, true);
  assert.equal(result.gap, 23);
  assert.equal(result.penalty, 23);
});

test("la penalización se resta del KPI 70/30 ya definido y no baja de 0", () => {
  assert.equal(applyPerformancePenalty(70, 25), 45);
  assert.equal(applyPerformancePenalty(10, 40), 0);
  const decorated = decorateKpiWithCompliance(
    { score: 80, total: 5 },
    { quotaPenalty: 8 },
  );
  assert.equal(decorated.baseScore, 80);
  assert.equal(decorated.score, 72);
});

test("la alerta de pantalla junta vencidas, meta diaria y ritmo semanal", () => {
  const snapshot = buildComplianceSnapshot({
    profile: { ...editor, linkedManagerId: manager.id, role: "editor" },
    today: "2026-10-28",
    nowMs: Date.parse("2026-10-28T12:00:00-06:00"),
    editingTasks: [{
      id: "late-edit",
      _taskType: "editingTask",
      contextId: editor.id,
      date: "2026-10-20",
      status: "editar",
    }],
    accountTasks: Array.from({ length: 10 }, (_, index) => ({
      id: `acc-${index}`,
      contextId: manager.id,
      date: "2026-10-27",
      status: index < 3 ? "publicado" : "por_disenar",
      completedAt: index < 3 ? "2026-10-27T15:00:00-06:00" : undefined,
    })),
    managementTasks: [],
  });
  assert.equal(snapshot.isAlerting, true);
  // 1 tarea de edicion + 7 publicaciones de Account sin publicar con fecha pasada.
  assert.equal(snapshot.overdueCount, 8);
  assert.equal(snapshot.overdueTasks.length, 8);
  assert.equal(snapshot.accountWeekly.behind, true);
  assert.ok(snapshot.alerts.some((item) => item.type === "overdue"));
  assert.ok(snapshot.alerts.some((item) => item.type === "account-pace"));
});

test("ejemplo del requerimiento: 35% de la semana transcurrido y 30% de publicaciones genera alerta", () => {
  const tuesdayFourPm = Date.parse("2026-10-27T16:00:00-06:00");
  assert.equal(getElapsedWorkWeekPercent({ today: "2026-10-27", nowMs: tuesdayFourPm }), 35);
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    id: `pub-${index}`,
    contextId: manager.id,
    date: "2026-10-30",
    status: index < 3 ? "publicado" : "por_disenar",
    completedAt: index < 3 ? "2026-10-27T10:00:00-06:00" : undefined,
  }));
  const snapshot = buildComplianceSnapshot({
    profile: manager,
    accountTasks: tasks,
    today: "2026-10-27",
    nowMs: tuesdayFourPm,
  });
  assert.equal(snapshot.accountWeekly.behind, true);
  assert.equal(snapshot.accountWeekly.progressPercent, 30);
  assert.equal(snapshot.accountWeekly.gap, 5);
  assert.equal(snapshot.quotaPenalty, 5);
  assert.equal(snapshot.overdueCount, 0);
  assert.equal(snapshot.accountWeekly.warn, false);
  assert.equal(snapshot.alerts.some((item) => item.type === "account-pace"), false);
  assert.equal(snapshot.isAlerting, false);
});

test("el aviso de incumplimiento aparece recien en la ultima hora", () => {
  const dueAt = Date.parse("2026-10-27T17:00:00-06:00");
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    id: `pub-${index}`,
    contextId: manager.id,
    date: "2026-10-27",
    time: "17:00",
    status: index < 3 ? "publicado" : "por_disenar",
    completedAt: index < 3 ? "2026-10-27T10:00:00-06:00" : undefined,
  }));
  const early = buildComplianceSnapshot({
    profile: manager,
    accountTasks: tasks,
    today: "2026-10-27",
    nowMs: dueAt - (2 * 60 * 60 * 1000),
  });
  assert.equal(early.dueSoonCount, 0);
  assert.equal(early.isAlerting, false);

  const withinHour = buildComplianceSnapshot({
    profile: manager,
    accountTasks: tasks,
    today: "2026-10-27",
    nowMs: dueAt - (30 * 60 * 1000),
  });
  assert.equal(withinHour.dueSoonCount, 7);
  assert.equal(withinHour.overdueCount, 0);
  assert.equal(withinHour.accountWeekly.warn, true);
  assert.equal(withinHour.isAlerting, true);
  assert.match(
    withinHour.alerts.find((item) => item.type === "account-pace").message,
    /30%/,
  );

  const overdue = buildComplianceSnapshot({
    profile: manager,
    accountTasks: tasks,
    today: "2026-10-27",
    nowMs: dueAt + (5 * 60 * 1000),
  });
  assert.equal(overdue.dueSoonCount, 0);
  assert.equal(overdue.overdueCount, 7);
  assert.equal(overdue.isAlerting, true);
});

test("un Account Manager al dia no genera alertas ni penalizacion", () => {
  const snapshot = buildComplianceSnapshot({
    profile: manager,
    accountTasks: Array.from({ length: 10 }, (_, index) => ({
      id: `ok-${index}`,
      contextId: manager.id,
      date: "2026-10-30",
      status: index < 6 ? "publicado" : "por_disenar",
      completedAt: index < 6 ? "2026-10-27T10:00:00-06:00" : undefined,
    })),
    today: "2026-10-27",
    nowMs: Date.parse("2026-10-27T16:00:00-06:00"),
  });
  assert.equal(snapshot.isAlerting, false);
  assert.equal(snapshot.quotaPenalty, 0);
});

test("la meta diaria del lunes se mide contra el viernes anterior", () => {
  const friday = "2026-10-23";
  const tasks = Array.from({ length: 5 }, (_, index) => ({
    id: `fri-${index}`,
    _taskType: "editingTask",
    contextId: editor.id,
    date: friday,
    status: index < 2 ? "revision_interna" : "editar",
    editorCompletedAt: index < 2 ? "2026-10-23T12:00:00-06:00" : undefined,
  }));
  const result = evaluateEditorDailyQuota({ tasks, profile: editor, today: "2026-10-26" });
  assert.equal(result.day, friday);
  assert.equal(result.missed, true);
  assert.equal(result.completed, 2);
  assert.equal(result.penalty, 12);
});

test("una tarea vence a su hora el mismo dia", () => {
  const task = {
    id: "today",
    _taskType: "accountTask",
    contextId: manager.id,
    date: "2026-10-28",
    time: "10:00",
    status: "por_disenar",
  };
  const base = { tasks: [task], profile: manager, today: "2026-10-28" };
  assert.equal(countOpenOverdueTasks({ ...base, nowMs: Date.parse("2026-10-28T09:00:00-06:00") }), 0);
  assert.equal(countOpenOverdueTasks({ ...base, nowMs: Date.parse("2026-10-28T10:01:00-06:00") }), 1);
});

test("los superiores son los de prioridad estrictamente mayor y los Account Managers solo si manejan el cliente", () => {
  const users = [
    { id: "u-admin", role: "super_admin" },
    { id: "u-ops", role: "operations" },
    { id: "u-mgmt", role: "management" },
    { id: "u-am1", role: "manager", linkedManagerId: "m1" },
    { id: "u-am2", role: "manager", linkedManagerId: "m2" },
    { id: "u-ed", role: "editor" },
    { id: "u-off", role: "super_admin", isActive: false },
  ];
  const ids = (list) => list.map((item) => item.id).sort();
  assert.deepEqual(
    ids(getSupervisorUsers({ role: "manager", users })),
    ["u-admin", "u-mgmt", "u-ops"],
  );
  assert.deepEqual(
    ids(getSupervisorUsers({ role: "editor", users, managerKeys: new Set(["m1"]) })),
    ["u-admin", "u-am1", "u-mgmt", "u-ops"],
  );
  assert.deepEqual(
    ids(getSupervisorUsers({ role: "editor", users, managerKeys: new Set(), excludeIds: ["u-ops"] })),
    ["u-admin", "u-mgmt"],
  );
});
