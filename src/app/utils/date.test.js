import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays, getLast24HoursRange, getWeekStartDate, isWeekendDate } from "./date.js";

test("addBusinessDays salta sabados y domingos", () => {
  assert.equal(addBusinessDays("2026-10-02", 2), "2026-10-06");
  assert.equal(addBusinessDays("2026-10-02", 1), "2026-10-05");
  assert.equal(addBusinessDays("2026-10-05", 2), "2026-10-07");
});

test("addBusinessDays conserva la fecha si no hay desplazamiento", () => {
  assert.equal(addBusinessDays("2026-10-02", 0), "2026-10-02");
  assert.equal(addBusinessDays("", 2), "");
});

test("getWeekStartDate ancla el lunes y detecta fin de semana", () => {
  assert.equal(getWeekStartDate("2026-10-28"), "2026-10-26");
  assert.equal(isWeekendDate("2026-10-31"), true);
  assert.equal(isWeekendDate("2026-10-28"), false);
});

test("getLast24HoursRange cubre exactamente un dia hacia atras", () => {
  const now = new Date("2026-10-22T21:00:00.000Z");
  const range = getLast24HoursRange(now);
  assert.equal(range.endMs - range.startMs, 24 * 60 * 60 * 1000);
  assert.equal(range.endMs, now.getTime());
  assert.equal(range.fromDate, "2026-10-21");
  assert.equal(range.toDate, "2026-10-22");
  assert.match(range.periodLabel, /Honduras/);
});
