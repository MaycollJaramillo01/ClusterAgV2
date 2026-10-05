export const KANBAN_PRIORITY_ROLES = new Set([
  "super_admin",
  "operations",
  "management",
]);

export const canReorderKanban = (profile) =>
  KANBAN_PRIORITY_ROLES.has(String(profile?.role || ""));

export const getBoardOrderValue = (task = {}) => {
  const numeric = Number(task?.boardOrder);
  return Number.isFinite(numeric) ? numeric : Number.POSITIVE_INFINITY;
};

export const sortKanbanColumnTasks = (tasks = []) =>
  [...tasks].sort((left, right) => {
    const order = getBoardOrderValue(left) - getBoardOrderValue(right);
    if (order !== 0) return order;
    return 0;
  });

export const buildKanbanReorderIds = ({
  columnTasks = [],
  draggedId,
  beforeId = null,
} = {}) => {
  const draggedKey = String(draggedId || "");
  if (!draggedKey) return columnTasks.map((task) => task.id).filter(Boolean);

  const dragged = columnTasks.find((task) => String(task.id) === draggedKey);
  const others = columnTasks.filter((task) => String(task.id) !== draggedKey);
  if (!dragged) return others.map((task) => task.id).filter(Boolean);

  const beforeKey = String(beforeId || "");
  const insertAt = beforeKey
    ? others.findIndex((task) => String(task.id) === beforeKey)
    : others.length;
  const index = insertAt < 0 ? others.length : insertAt;
  const ordered = [...others];
  ordered.splice(index, 0, dragged);
  return ordered.map((task) => task.id).filter(Boolean);
};

export const toBoardOrderValue = (index) => (Number(index) + 1) * 10;
