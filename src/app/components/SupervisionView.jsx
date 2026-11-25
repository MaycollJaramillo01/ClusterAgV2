import React, { useEffect, useMemo, useState } from "react";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Text } from "@astryxdesign/core/Text";
import {
  buildClientQuotaUsage,
  getTaskApprovalTimestamp,
  SUPERVISION_QUOTA_CATEGORIES,
} from "../utils/supervision.js";

const COMPLETED_STATUSES = new Set(["aprobado", "publicado", "cerrado"]);
const APPROVED_STATUSES = new Set(["aprobado", "publicado"]);
const TASK_STATUS_LABELS = {
  editar: "Pendiente",
  en_edicion: "En edición",
  correccion: "Corrección",
  revision_interna: "Revisión interna",
  aprobado: "Aprobado",
  publicado: "Publicado",
  cerrado: "Cerrado",
};

const formatUnits = (value) => Number(value || 0).toLocaleString("es-HN", {
  maximumFractionDigits: 2,
});

const getTaskCategory = (task) => (
  SUPERVISION_QUOTA_CATEGORIES.some(({ id }) => id === task.quotaCategory)
    ? task.quotaCategory
    : "videos"
);

const formatTaskDate = (value) => {
  if (!value) return "Sin fecha";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const date = new Date(isDateOnly ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat("es-HN", {
      dateStyle: "medium",
      timeZone: isDateOnly ? "UTC" : "America/Tegucigalpa",
    }).format(date);
};

export default function SupervisionView({
  clients = [],
  plans = [],
  editingTasks = [],
  managers = [],
  editors = [],
  settings = null,
  period,
  canManageClients = false,
  canManageReports = false,
  canManagePlans = false,
  canCreateTasks = false,
  onEditClient,
  onCreateTask,
  onOpenTask,
  onSavePlan,
  onSaveSettings,
}) {
  const [frequency, setFrequency] = useState(settings?.frequency || "weekly");
  const [recipientsText, setRecipientsText] = useState((settings?.recipients || []).join("\n"));
  const [clientFilter, setClientFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planDraft, setPlanDraft] = useState({
    name: "",
    monthlyQuota: { videos: 0, publications: 0, advertising: 0 },
  });
  const usageByClient = useMemo(
    () => buildClientQuotaUsage(clients, editingTasks, period),
    [clients, editingTasks, period],
  );
  const clientById = useMemo(
    () => new Map(clients.map((client) => [String(client.id), client])),
    [clients],
  );
  const selectedClient = clients.find(
    (client) => String(client.id) === selectedClientId,
  ) || clients[0] || null;
  const selectedClientUsage = selectedClient
    ? usageByClient.get(String(selectedClient.id))
    : null;
  const selectedManager = selectedClient
    ? managers.find((person) => String(person.id) === String(selectedClient.managerId || ""))
    : null;
  const selectedEditor = selectedClient
    ? editors.find((person) => String(person.id) === String(selectedClient.editorId || ""))
    : null;
  const approvedThisMonth = editingTasks.filter((task) => (
    getTaskApprovalTimestamp(task).slice(0, 7) === period
  )).length;
  const activeTaskCount = editingTasks.filter(
    (task) => !COMPLETED_STATUSES.has(task.status),
  ).length;
  const overQuotaCount = Array.from(usageByClient.values()).reduce(
    (count, categories) => count + Object.values(categories).filter(
      (usage) => usage.quota > 0 && usage.percentage > 100,
    ).length,
    0,
  );
  const visibleTasks = editingTasks
    .filter((task) => {
      const taskClientId = String(task.clientId || "");
      const category = getTaskCategory(task);
      if (clientFilter !== "all" && taskClientId !== clientFilter) return false;
      if (categoryFilter !== "all" && category !== categoryFilter) return false;
      if (statusFilter === "active" && COMPLETED_STATUSES.has(task.status)) return false;
      if (statusFilter === "approved" && !APPROVED_STATUSES.has(task.status)) return false;
      if (searchTerm && !String(task.title || "").toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    })
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(
      String(left.updatedAt || left.createdAt || ""),
    ));

  useEffect(() => {
    setFrequency(settings?.frequency || "weekly");
    setRecipientsText((settings?.recipients || []).join("\n"));
  }, [settings?.frequency, settings?.recipients]);
  useEffect(() => {
    if (!clients.some((client) => String(client.id) === selectedClientId)) {
      setSelectedClientId(String(clients[0]?.id || ""));
    }
  }, [clients, selectedClientId]);

  const handleSaveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings?.({
        id: "global",
        frequency,
        recipients: recipientsText.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };
  const handleSavePlan = async (event) => {
    event.preventDefault();
    setPlanSaving(true);
    try {
      const saved = await onSavePlan?.({
        ...planDraft,
        name: planDraft.name.trim(),
      });
      if (saved) {
        setPlanDraft({
          name: "",
          monthlyQuota: { videos: 0, publications: 0, advertising: 0 },
        });
      }
    } finally {
      setPlanSaving(false);
    }
  };
  const editPlan = (plan) => setPlanDraft({
    id: plan.id,
    name: plan.name,
    monthlyQuota: {
      videos: plan.monthlyQuota?.videos ?? 0,
      publications: plan.monthlyQuota?.publications ?? 0,
      advertising: plan.monthlyQuota?.advertising ?? 0,
    },
  });
  const resetPlanDraft = () => setPlanDraft({
    name: "",
    monthlyQuota: { videos: 0, publications: 0, advertising: 0 },
  });

  return (
    <main className="space-y-6 fade-in">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <section>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Centro de control</p>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white">Sala de Supervisión</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Actividades, responsables y consumo de cuotas en tiempo real · {period}.
          </p>
        </section>
        <section className="flex items-center gap-3">
          <p className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-200">
            Actualización en tiempo real
          </p>
          {canCreateTasks && (
            <button
              type="button"
              onClick={onCreateTask}
              className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 dark:bg-cyan-600 dark:hover:bg-cyan-500"
            >
              Nueva actividad
            </button>
          )}
        </section>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Actividades activas", value: activeTaskCount, tone: "text-cyan-700 dark:text-cyan-300" },
          { label: "Aprobadas este mes", value: approvedThisMonth, tone: "text-emerald-700 dark:text-emerald-300" },
          { label: "Cuotas excedidas", value: overQuotaCount, tone: "text-red-700 dark:text-red-300" },
        ].map((metric) => (
          <article key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500 dark:text-slate-400">{metric.label}</p>
            <p className={`mt-1 text-2xl font-black ${metric.tone}`}>{metric.value}</p>
          </article>
        ))}
      </section>

      <Collapsible
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        defaultIsOpen
        trigger={(
          <Text
            type="large"
            size="lg"
            weight="bold"
            color="primary"
            display="block"
            className="p-5"
          >
            Seguimiento de actividades
          </Text>
        )}
      >
        <section className="space-y-4 border-t border-slate-100 p-5 dark:border-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Revisa el estado, la cuota asignada y las personas responsables de cada entrega.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Buscar
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Nombre de actividad"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Cliente
              <select
                value={clientFilter}
                onChange={(event) => setClientFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="all">Todos los clientes</option>
                {clients.map((client) => (
                  <option key={client.id} value={String(client.id)}>{client.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Actividad
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="all">Todas las actividades</option>
                {SUPERVISION_QUOTA_CATEGORIES.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Estado
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="active">Activas</option>
                <option value="approved">Aprobadas</option>
                <option value="all">Todas</option>
              </select>
            </label>
          </form>
        {visibleTasks.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            No hay actividades que coincidan con los filtros.
          </p>
        ) : (
          <section className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950">
                <tr>
                  <th className="px-4 py-3">Actividad</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Responsables</th>
                  <th className="px-4 py-3">Cuota</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => {
                  const client = clientById.get(String(task.clientId || ""));
                  const manager = managers.find((person) => String(person.id) === String(task.accountId || client?.managerId || ""));
                  const editor = editors.find((person) => String(person.id) === String(task.contextId || client?.editorId || ""));
                  const category = SUPERVISION_QUOTA_CATEGORIES.find(({ id }) => id === getTaskCategory(task));
                  return (
                    <tr key={task.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onOpenTask?.(task)}
                          className="text-left font-semibold text-cyan-800 hover:underline dark:text-cyan-300"
                        >
                          {task.title || "Actividad sin título"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{client?.name || "Sin cliente"}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <p>{manager?.name || "Sin Account Manager"}</p>
                        <p className="text-xs text-slate-400">{editor?.name || "Sin Editor"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {category?.label || "Videos"} · {Number(task.quotaPercent || 100)}%
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {TASK_STATUS_LABELS[task.status] || task.status || "Sin estado"}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {formatTaskDate(task.date || task.updatedAt || task.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
        </section>
      </Collapsible>

      {canManagePlans && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <header>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Planes de clientes</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Crea planes reutilizables; al asignarlos en la ficha del cliente, sus cuotas quedan vinculadas al plan.
            </p>
          </header>
          <form onSubmit={handleSavePlan} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Nombre del plan
              <input
                type="text"
                value={planDraft.name}
                onChange={(event) => setPlanDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ej. Plan crecimiento"
                maxLength={120}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            {SUPERVISION_QUOTA_CATEGORIES.map(({ id, label }) => (
              <label key={id} className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Cuota mensual: {label}
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={planDraft.monthlyQuota[id]}
                  onChange={(event) => setPlanDraft((current) => ({
                    ...current,
                    monthlyQuota: {
                      ...current.monthlyQuota,
                      [id]: event.target.value,
                    },
                  }))}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
            ))}
            <section className="flex items-end gap-2">
              <button
                type="submit"
                disabled={planSaving}
                className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500"
              >
                {planSaving ? "Guardando..." : planDraft.id ? "Guardar cambios" : "Crear plan"}
              </button>
              {planDraft.id && (
                <button
                  type="button"
                  onClick={resetPlanDraft}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                >
                  Cancelar
                </button>
              )}
            </section>
          </form>
          {plans.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Todavía no hay planes creados.</p>
          ) : (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <article key={plan.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <header className="flex items-start justify-between gap-3">
                    <section>
                      <h3 className="font-bold text-slate-800 dark:text-white">{plan.name}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {clients.filter((client) => String(client.planId || "") === String(plan.id)).length} clientes asignados
                      </p>
                    </section>
                    <button
                      type="button"
                      onClick={() => editPlan(plan)}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                      Editar
                    </button>
                  </header>
                  <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                    {SUPERVISION_QUOTA_CATEGORIES.map(({ id, label }) => (
                      `${label}: ${plan.monthlyQuota?.[id] ?? 0}`
                    )).join(" · ")}
                  </p>
                </article>
              ))}
            </section>
          )}
        </section>
      )}

      <section className="space-y-4">
        <header>
          <h2 className="font-bold text-slate-800 dark:text-white">Cuotas mensuales por cliente</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cada aprobación descuenta el porcentaje configurado, sin limitar los excesos.
          </p>
        </header>
        {clients.length === 0 ? (
          <p className="rounded-xl border border-slate-200 p-6 text-sm text-slate-500 dark:border-slate-800">
            No hay clientes registrados.
          </p>
        ) : (
          <>
            <TabList
              value={String(selectedClient?.id || "")}
              onChange={setSelectedClientId}
              aria-label="Clientes supervisados"
              size="sm"
              hasDivider
              overflow="auto"
            >
              {clients.map((client) => (
                <Tab
                  key={client.id}
                  value={String(client.id)}
                  label={client.name || "Cliente sin nombre"}
                  panelId="supervision-client-panel"
                />
              ))}
            </TabList>
            {selectedClient && (
              <article
                id="supervision-client-panel"
                role="tabpanel"
                aria-label={`${selectedClient.name} cuotas mensuales`}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
                  <section>
                    <h3 className="font-bold text-slate-800 dark:text-white">{selectedClient.name}</h3>
                    <p className="text-xs text-slate-500">
                      {selectedClient.planName || selectedClient.package || "Plan sin nombre"} · Account: {selectedManager?.name || "Sin asignar"} · Editor: {selectedEditor?.name || "Sin asignar"}
                    </p>
                  </section>
                  {canManageClients && (
                    <button
                      type="button"
                      onClick={() => onEditClient?.(selectedClient)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Editar plan y responsables
                    </button>
                  )}
                </header>
                <section className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950">
                      <tr>
                        <th className="px-4 py-3">Actividad</th>
                        <th className="px-4 py-3">Cuota mensual</th>
                        <th className="px-4 py-3">Unidades aprobadas</th>
                        <th className="px-4 py-3">Consumo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SUPERVISION_QUOTA_CATEGORIES.map(({ id, label }) => {
                        const usage = selectedClientUsage?.[id] || { quota: 0, units: 0, percentage: 0, taskCount: 0 };
                        const exceeded = usage.percentage > 100;
                        return (
                          <tr key={id} className="border-t border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">{label}</th>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{usage.quota || "Sin cuota"}</td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                              {formatUnits(usage.units)} <span className="text-xs text-slate-400">({usage.taskCount} tareas)</span>
                            </td>
                            <td className={`px-4 py-3 font-black ${exceeded ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-white"}`}>
                              {usage.quota ? `${Math.round(usage.percentage)}%` : "—"}
                              {exceeded && <span className="ml-2 text-xs uppercase">Excedido</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              </article>
            )}
          </>
        )}
      </section>

      {canManageReports && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-bold text-slate-800 dark:text-white">Reportes automáticos</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            El correo incluye el estado de cuotas de clientes. También se envía a usuarios con permiso para recibir reportes.
          </p>
          <form onSubmit={handleSaveSettings} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Frecuencia
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
              </select>
            </label>
            <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Destinatarios adicionales
              <textarea
                value={recipientsText}
                onChange={(event) => setRecipientsText(event.target.value)}
                placeholder="correo@empresa.com"
                rows={3}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Puedes separar correos con comas o saltos de línea. La ejecución automática requiere SMTP y el cron configurados.
            </p>
            <button
              type="submit"
              disabled={saving}
              className="w-fit rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-50 dark:bg-cyan-600 dark:hover:bg-cyan-500"
            >
              {saving ? "Guardando..." : "Guardar configuración"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
