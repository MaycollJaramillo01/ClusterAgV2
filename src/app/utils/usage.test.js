import assert from "node:assert/strict";
import test from "node:test";
import {
  applyUsageVisit,
  featureForCollection,
  featureForView,
  summarizeTeamUsage,
  usageReportCsv,
  usageWindow,
} from "./usage.js";

test("cada vista y cada colección caen en una función del equipo", () => {
  assert.equal(featureForView("account-room"), "account-room");
  assert.equal(featureForView("client-detail"), "clients");
  assert.equal(featureForView("general-calendar"), "calendar");
  assert.equal(featureForCollection("editing"), "editions");
  assert.equal(featureForCollection("client_chats"), "chat");
  assert.equal(featureForCollection("audit_logs"), "");
});

test("una visita repetida dentro de dos minutos no suma", () => {
  const now = Date.parse("2026-11-17T21:00:00.000Z");
  const first = applyUsageVisit({}, "chat", now);
  assert.equal(first.visits.chat, 1);
  const record = { visits: first.visits, lastFeatureAt: first.lastFeatureAt };
  assert.equal(applyUsageVisit(record, "chat", now + 60_000), null);
  assert.equal(applyUsageVisit(record, "chat", now + 130_000).visits.chat, 2);
  assert.equal(applyUsageVisit(record, "desconocida", now), null);
});

test("el informe junta visitas, acciones y a quien no usó nada", () => {
  const people = summarizeTeamUsage({
    start: "2026-11-01",
    end: "2026-11-17",
    users: [
      { id: "user-1", name: "Ana", email: "ana@cluster.ag", role: "manager", isActive: true },
      { id: "user-2", name: "Luis", email: "luis@cluster.ag", role: "editor", isActive: true },
      { id: "user-4", name: "Vera", email: "vera@cluster.ag", role: "manager", isActive: true },
      { id: "user-3", name: "Inactivo", isActive: false },
    ],
    visits: [
      { userId: "user-1", date: "2026-11-17", visits: { "account-room": 3, chat: 1 }, lastAt: "2026-11-17T20:00:00.000Z" },
      { userId: "user-1", date: "2026-10-01", visits: { chat: 9 } },
    ],
    auditLogs: [
      {
        entityType: "editing",
        createdAt: "2026-11-16T18:00:00.000Z",
        actor: { uid: "user-2", name: "Luis" },
      },
      {
        entityType: "account_tasks",
        createdAt: "2026-11-17T15:00:00.000Z",
        actor: { uid: "user-1" },
      },
    ],
  });
  assert.deepEqual(people.map((person) => person.id), ["user-1", "user-2", "user-4"]);
  assert.equal(people[0].visits, 4);
  assert.equal(people[0].actions, 1);
  assert.equal(people[0].features.find((feature) => feature.id === "account-room").actions, 1);
  assert.equal(people[1].features[0].label, "Sala de Edición");
  assert.equal(people[1].actions, 1);
  const csv = usageReportCsv(people, { start: "2026-11-01", end: "2026-11-17" });
  assert.match(csv, /Ana,ana@cluster.ag,manager,4,1/);
  assert.match(csv, /Sala de Edición: 0 visitas, 1 accion/);
  assert.match(csv, /Vera,vera@cluster.ag,manager,0,0/);
});

test("la ventana de uso usa días de Honduras", () => {
  const window = usageWindow(7, new Date("2026-11-17T21:30:00.000Z"));
  assert.equal(window.end, "2026-11-17");
  assert.equal(window.start, "2026-11-11");
  assert.equal(window.createdFrom, "2026-11-11T06:00:00.000Z");
  assert.equal(window.createdTo, "2026-11-18T06:00:00.000Z");
});
