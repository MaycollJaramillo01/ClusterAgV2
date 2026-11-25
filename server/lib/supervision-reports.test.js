import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSupervisionReportHtml,
  getSupervisionReportPeriod,
} from "./supervision-reports.js";

test("supervision report frequencies are scheduled on Honduras calendar boundaries", () => {
  assert.equal(getSupervisionReportPeriod("daily", new Date("2026-11-25T18:00:00Z")).due, true);
  assert.equal(getSupervisionReportPeriod("weekly", new Date("2026-11-23T12:00:00Z")).due, true);
  assert.equal(getSupervisionReportPeriod("weekly", new Date("2026-11-24T12:00:00Z")).due, false);
  assert.equal(getSupervisionReportPeriod("monthly", new Date("2026-12-01T12:00:00Z")).due, true);
  assert.equal(getSupervisionReportPeriod("monthly", new Date("2026-12-01T12:00:00Z")).key, "2026-11");
});

test("supervision report HTML escapes client data and includes over-quota percentages", () => {
  const html = buildSupervisionReportHtml({
    clients: [{ id: "c1", name: "<ACME>", planName: "Base" }],
    usageByClient: new Map([["c1", {
      videos: { quota: 10, units: 12, percentage: 120 },
    }]]),
    periodLabel: "2026-11",
  });
  assert.match(html, /&lt;ACME&gt;/);
  assert.match(html, /120%/);
});
