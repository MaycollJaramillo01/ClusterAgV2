import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClientQuotaUsage,
  getTaskApprovalTimestamp,
} from "./supervision.js";

test("weighted approvals calculate monthly quota use and allow overages", () => {
  const clients = [{ id: "client-1", monthlyQuota: { videos: 10 } }];
  const tasks = [
    { id: "one", clientId: "client-1", status: "aprobado", approvedAt: "2026-11-02T10:00:00Z", quotaPercent: 100 },
    { id: "two", clientId: "client-1", status: "publicado", publishedAt: "2026-11-03T10:00:00Z", quotaPercent: 30 },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `extra-${index}`,
      clientId: "client-1",
      status: "aprobado",
      approvedAt: "2026-11-04T10:00:00Z",
      quotaPercent: 100,
    })),
    { id: "last-month", clientId: "client-1", status: "aprobado", approvedAt: "2026-10-30T10:00:00Z" },
    { id: "other-client", clientId: "client-2", status: "aprobado", approvedAt: "2026-11-04T10:00:00Z" },
    { id: "pending", clientId: "client-1", status: "revision_interna", updatedAt: "2026-11-04T10:00:00Z" },
  ];

  const usage = buildClientQuotaUsage(clients, tasks, "2026-11").get("client-1").videos;
  assert.equal(usage.units, 11.3);
  assert.equal(usage.taskCount, 12);
  assert.equal(usage.percentage, 113);
});

test("approval timestamps are stable after a task returns to editing", () => {
  assert.equal(
    getTaskApprovalTimestamp({
      status: "en_edicion",
      approvedAt: "2026-11-05T10:00:00Z",
    }),
    "2026-11-05T10:00:00Z",
  );
  assert.equal(getTaskApprovalTimestamp({ status: "revision_interna" }), "");
});

test("twelve fully weighted approvals show 120 percent against a ten-unit plan", () => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    id: `video-${index}`,
    clientId: "client-1",
    status: "aprobado",
    approvedAt: "2026-11-06T10:00:00Z",
    quotaCategory: "videos",
    quotaPercent: 100,
  }));
  const usage = buildClientQuotaUsage(
    [{ id: "client-1", monthlyQuota: { videos: 10 } }],
    tasks,
    "2026-11",
  ).get("client-1").videos;
  assert.equal(usage.percentage, 120);
});
