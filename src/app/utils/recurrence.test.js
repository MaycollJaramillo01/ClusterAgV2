import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecurrenceDates,
  buildRecurrencePayload,
  nextRecurrenceDate,
  normalizeRecurrence,
} from "./recurrence.js";

test("nextRecurrenceDate avanza por frecuencia", () => {
  assert.equal(nextRecurrenceDate("2026-10-02", "daily"), "2026-10-03");
  assert.equal(nextRecurrenceDate("2026-10-02", "weekdays"), "2026-10-05");
  assert.equal(nextRecurrenceDate("2026-10-02", "weekly"), "2026-10-09");
  assert.equal(nextRecurrenceDate("2026-10-02", "biweekly"), "2026-10-16");
  assert.equal(nextRecurrenceDate("2026-01-31", "monthly"), "2026-02-28");
});

test("buildRecurrenceDates respeta until y el tope", () => {
  assert.deepEqual(
    buildRecurrenceDates({ startDate: "2026-10-05", frequency: "weekly", until: "2026-10-26" }),
    ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
  );
  assert.equal(
    buildRecurrenceDates({ startDate: "2026-10-05", frequency: "daily" }).length,
    30,
  );
  assert.deepEqual(
    buildRecurrenceDates({ startDate: "2026-10-05", frequency: "none" }),
    ["2026-10-05"],
  );
});

test("normalizeRecurrence descarta valores invalidos", () => {
  assert.deepEqual(normalizeRecurrence({ frequency: "yearly", until: "nope" }), {
    frequency: "none",
    until: "",
  });
  assert.deepEqual(normalizeRecurrence({ frequency: "weekly", until: "2026-11-01" }), {
    frequency: "weekly",
    until: "2026-11-01",
  });
});

test("buildRecurrencePayload arma la serie cuando hay repeticion", () => {
  const none = buildRecurrencePayload({ date: "2026-10-05", recurrence: { frequency: "none" } });
  assert.deepEqual(none.dates, ["2026-10-05"]);
  assert.equal(none.recurrence, null);

  const weekly = buildRecurrencePayload({
    date: "2026-10-05",
    recurrence: { frequency: "weekly", until: "2026-10-19" },
  });
  assert.deepEqual(weekly.dates, ["2026-10-05", "2026-10-12", "2026-10-19"]);
  assert.equal(weekly.recurrence.frequency, "weekly");
  assert.equal(weekly.recurrence.total, 3);
  assert.ok(weekly.recurrence.seriesId);
});
