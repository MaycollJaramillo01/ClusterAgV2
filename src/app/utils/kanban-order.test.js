import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKanbanReorderIds,
  canReorderKanban,
  sortKanbanColumnTasks,
  toBoardOrderValue,
} from "./kanban-order.js";

test("solo gestion, operaciones y super admin reordenan el kanban", () => {
  assert.equal(canReorderKanban({ role: "management" }), true);
  assert.equal(canReorderKanban({ role: "operations" }), true);
  assert.equal(canReorderKanban({ role: "super_admin" }), true);
  assert.equal(canReorderKanban({ role: "editor" }), false);
  assert.equal(canReorderKanban({ role: "manager" }), false);
});

test("sortKanbanColumnTasks pone boardOrder arriba y deja el resto estable", () => {
  const sorted = sortKanbanColumnTasks([
    { id: "c", boardOrder: 30 },
    { id: "a" },
    { id: "b", boardOrder: 10 },
  ]);
  assert.deepEqual(
    sorted.map((task) => task.id),
    ["b", "c", "a"],
  );
});

test("buildKanbanReorderIds inserta antes de la tarjeta destino o al final", () => {
  const column = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    buildKanbanReorderIds({ columnTasks: column, draggedId: "c", beforeId: "a" }),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    buildKanbanReorderIds({ columnTasks: column, draggedId: "a" }),
    ["b", "c", "a"],
  );
});

test("toBoardOrderValue deja huecos para reordenar sin reescribir todo", () => {
  assert.equal(toBoardOrderValue(0), 10);
  assert.equal(toBoardOrderValue(2), 30);
});
