import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagerKpiStats,
  buildPersonalKpiSnapshot,
  buildTeamKpiStats,
  calculateKpiScore,
  getKpiHistoryPatch,
  getKpiPeriod,
  getKpiTaskMeta,
  getStatusTimestampPatch,
} from "./kpi.js";

const today = "2026-06-19";
const period = getKpiPeriod(today);
const manager = { id: "manager-1", userId: "user-1" };
const editor = { id: "editor-1", userId: "user-2" };
const onTime = "2026-06-10T15:00:00Z";
const late = "2026-06-12T15:00:00Z";
const makeTasks = (overrides = {}, count = 5) => Array.from({ length: count }, (_, i) => ({
  id: `task-${i}`,
  _taskType: "accountTask",
  contextId: manager.id,
  hierarchy: "p2",
  date: "2026-06-10",
  status: "publicado",
  completedAt: onTime,
  ...overrides,
}));
const team = (tasks, person = manager, kind = "manager", span = period) =>
  buildTeamKpiStats({ people: [person], tasks, kind, period: span, today })[0];
const personal = (tasks, profile = { id: manager.userId, linkedManagerId: manager.id }, span = period) =>
  buildPersonalKpiSnapshot(tasks, span, profile, today);

const assertSameKpi = (home, performance) => {
  for (const key of ["score", "total", "completed", "pending", "weightedTotal",
    "weightedCompleted", "onTimePercent", "measuredCompletionCount", "qualified"]) {
    assert.equal(home[key], performance[key], key);
  }
};

test("Inicio y Rendimiento reconocen la entrega a revisión interna", () => {
  const tasks = makeTasks({
    _taskType: "editingTask", contextId: editor.id,
    status: "revision_interna", completedAt: undefined, editorCompletedAt: onTime,
  });
  const home = personal(tasks, { id: editor.userId, linkedEditorId: editor.id });
  const performance = team(tasks, editor, "editor");
  assert.equal(home.score, 100);
  assert.equal(home.completed, 5);
  assertSameKpi(home, performance);
});

test("publicar después del plazo no cambia la aprobación entregada a tiempo", () => {
  const tasks = makeTasks({
    publishedAt: late,
    statusTimestamps: { aprobado_internamente: onTime, publicado: late },
  });
  assert.equal(personal(tasks).score, 100);
  assertSameKpi(personal(tasks), team(tasks));
});

test("el vencimiento histórico determina el mes y la puntualidad", () => {
  const tasks = makeTasks({
    date: "2026-07-10", dueDateAtCompletion: "2026-06-10", completedAt: late,
  });
  assert.equal(personal(tasks).score, 70);
  assert.equal(personal(tasks).onTimePercent, 0);
  assertSameKpi(personal(tasks), team(tasks));
  const july = { start: "2026-07-01", end: "2026-07-31" };
  assert.equal(personal(tasks, undefined, july).total, 0);
  assert.equal(team(tasks, manager, "manager", july).total, 0);
});

test("completar la quinta tarea tarde aumenta el KPI sin activar otro cálculo", () => {
  const tasks = makeTasks({ completedAt: late });
  tasks[4] = { ...tasks[4], status: "por_disenar", completedAt: undefined };
  assert.equal(team(tasks).score, 56);
  tasks[4] = { ...tasks[4], status: "publicado", completedAt: late };
  assert.equal(team(tasks).score, 70);
});

test("completar tarde nunca resta puntos, incluso con cargas y prioridades distintas", () => {
  for (const hierarchy of ["p1", "p2", "p3", "p4"]) {
    for (let completed = 0; completed < 10; completed++) {
      const tasks = makeTasks({}, 10).map((task, i) => ({
        ...task, hierarchy: i === completed ? hierarchy : "p2",
        status: i < completed ? "publicado" : "por_disenar",
        completedAt: i < completed ? onTime : undefined,
      }));
      const before = team(tasks).score;
      tasks[completed] = { ...tasks[completed], status: "publicado", completedAt: late };
      assert.ok(team(tasks).score >= before, `${hierarchy}, ${completed} completadas`);
    }
  }
});

test("sin evidencia de entrega no se acredita puntualidad y la nota queda provisional", () => {
  const tasks = makeTasks({ completedAt: undefined, updatedAt: onTime });
  const result = team(tasks);
  assert.equal(result.score, 70);
  assert.equal(result.onTimePercent, null);
  assert.equal(result.measuredCompletionCount, 0);
  assert.equal(result.missingTimingCount, 5);
  assert.equal(result.qualified, false);
  assert.match(result.provisionalReason, /sin fecha/);
  assertSameKpi(personal(tasks), result);
});

test("las fechas inválidas tampoco se cuentan como mediciones verificables", () => {
  const tasks = makeTasks({
    _taskType: "editingTask", contextId: editor.id,
    status: "revision_interna", completedAt: undefined, editorCompletedAt: "inválida",
  });
  const result = team(tasks, editor, "editor");
  assert.equal(result.measuredCompletionCount, 0);
  assert.equal(result.score, 70);
  assert.equal(result.qualified, false);
});

test("una marca antigua de revisión interna acredita la entrega aunque la aprobación sea posterior", () => {
  const tasks = makeTasks({
    _taskType: "editingTask", contextId: editor.id, status: "aprobado",
    completedAt: late, editorCompletedAt: "inválida",
    statusTimestamps: { revision_interna: onTime, aprobado: late },
  });
  assert.equal(team(tasks, editor, "editor").score, 100);
});

test("todos los responsables reciben la tarea una sola vez", () => {
  const second = { id: "manager-2", userId: "user-3" };
  const tasks = makeTasks({
    assigneeUserId: manager.userId,
    assignees: [manager.id, manager.userId, manager.id, second.id],
  });
  const results = buildTeamKpiStats({ people: [manager, second], tasks, period, today });
  assert.deepEqual(results.map((item) => item.total), [5, 5]);
  assertSameKpi(personal(tasks, { id: second.userId, linkedManagerId: second.id }), results[1]);
});

test("reasignar una tarea completada conserva el crédito de los responsables originales", () => {
  const original = makeTasks({ assignees: [manager.id, "manager-2"] })[0];
  const task = {
    ...original, ...getKpiHistoryPatch(original),
    contextId: "manager-3", assignees: ["manager-3"], date: "2026-07-10",
  };
  const people = [manager, { id: "manager-2" }, { id: "manager-3" }];
  const results = buildTeamKpiStats({ people, tasks: [task], period, today });
  assert.deepEqual(results.map((item) => item.total), [1, 1, 0]);
  assertSameKpi(personal([task]), results[0]);
  assert.equal(personal([task], { id: "manager-3" }).total, 0);
});

test("un propietario histórico antiguo no se reemplaza por los responsables actuales", () => {
  const tasks = makeTasks({
    contextId: "manager-2", assignees: ["manager-2"], ownerAtCompletionId: manager.id,
  });
  assert.equal(team(tasks).total, 5);
  assert.equal(team(tasks, { id: "manager-2" }).total, 0);
  const patch = getKpiHistoryPatch(tasks[0]);
  assert.equal(patch.ownerAtCompletionId, undefined);
  assert.equal(patch.assigneesAtCompletion, undefined);
});

test("ambas pantallas consolidan Accounts, Edición y Gestión del mismo perfil", () => {
  const profile = { id: manager.userId, linkedManagerId: manager.id, linkedEditorId: editor.id };
  const tasks = [
    ...makeTasks({}, 2),
    ...makeTasks({ _taskType: "editingTask", contextId: editor.id,
      status: "revision_interna", editorCompletedAt: onTime }, 2),
    ...makeTasks({ _taskType: "managementTask", contextId: manager.userId,
      status: "cerrado" }, 1),
  ];
  const result = team(tasks, { ...manager, ...profile });
  assert.equal(result.total, 5);
  assert.equal(result.score, 100);
  assertSameKpi(personal(tasks, profile), result);
});

test("las tareas devueltas al editor vuelven a estar pendientes", () => {
  const tasks = makeTasks({ _taskType: "editingTask", contextId: editor.id,
    status: "en_edicion", editorCompletedAt: onTime });
  const result = team(tasks, editor, "editor");
  assert.equal(result.completed, 0);
  assert.equal(result.pending, 5);
  assert.equal(result.score, 0);
});

test("el periodo predeterminado llega hasta hoy y respeta el día de Honduras", () => {
  assert.deepEqual(getKpiPeriod(today), { start: "2026-06-01", end: today });
  assert.deepEqual(getKpiPeriod("2026-07-01T02:00:00Z"), {
    start: "2026-06-01", end: "2026-06-30",
  });
  const tasks = makeTasks({ date: "2026-06-25", status: "por_disenar" });
  assert.equal(personal(tasks).total, 0);
  assert.equal(team(tasks).total, 0);
});

test("la fecha límite incluye todo el día local, no el día UTC", () => {
  assert.equal(team(makeTasks({ completedAt: "2026-06-11T05:59:59Z" })).score, 100);
  assert.equal(team(makeTasks({ completedAt: "2026-06-11T06:00:00Z" })).score, 70);
});

test("el cálculo pondera antes de redondear y controla valores vacíos o inválidos", () => {
  assert.equal(calculateKpiScore({ weightedTotal: 7, weightedCompleted: 4, onTimeWeight: 1 }), 44);
  assert.equal(calculateKpiScore(), 0);
  assert.equal(calculateKpiScore({ weightedTotal: NaN }), 0);
  assert.equal(calculateKpiScore({ weightedTotal: Infinity }), 0);
  assert.equal(calculateKpiScore({ weightedTotal: 4, weightedCompleted: 10, onTimeWeight: 10 }), 100);
  assert.equal(calculateKpiScore({ weightedTotal: 4, weightedCompleted: -1 }), 0);
  const tasks = [
    ...makeTasks({ hierarchy: "p1", completedAt: late }, 1),
    ...makeTasks({ hierarchy: "p2", status: "por_disenar" }, 1),
  ];
  assert.equal(team(tasks).score, 40);
});

test("el ranking de managers utiliza el mismo cálculo ponderado", () => {
  const tasks = makeTasks();
  tasks[0] = { ...tasks[0], hierarchy: "p1", completedAt: late };
  const [ranking] = buildManagerKpiStats({ managers: [manager], accountTasks: tasks,
    rankingPeriod: period, today });
  assertSameKpi(personal(tasks), ranking);
  assert.equal(ranking.score, 93);
});

test("las transiciones guardan responsables y vencimiento antes de modificaciones posteriores", () => {
  for (const [workflow, status, taskType, prefix] of [
    ["account", "aprobado_internamente", "accountTask", ""],
    ["editing", "revision_interna", "editingTask", "editor"],
    ["management", "cerrado", "managementTask", ""],
  ]) {
    const original = makeTasks({ _taskType: taskType, status: "en_edicion",
      completedAt: undefined, assigneeUserId: manager.userId,
      assignees: [manager.id, "manager-2"] })[0];
    const patch = getStatusTimestampPatch(original, status, onTime, manager.userId, workflow);
    assert.equal(patch[prefix ? "editorOwnerAtCompletionId" : "ownerAtCompletionId"], manager.id);
    assert.deepEqual(patch[prefix ? "editorAssigneesAtCompletion" : "assigneesAtCompletion"], original.assignees);
    const task = { ...original, ...patch, status, contextId: "manager-3", date: "2026-07-01" };
    const meta = getKpiTaskMeta(task);
    assert.ok(meta.ownerIds.includes(manager.id));
    assert.ok(!meta.ownerIds.includes("manager-3"));
    assert.equal(meta.dueDate, original.date);
    assert.equal(meta.completionIso, onTime);
  }
});
