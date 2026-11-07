import assert from "node:assert/strict";
import test from "node:test";
import {
  addBusinessDays,
  getLast24HoursRange,
  getWeekStartDate,
  isWeekendDate,
  parseBusinessDueMs,
  storedDueToViewer,
  viewerDueToStored,
} from "./date.js";

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

test("parseBusinessDueMs interpreta date+time como Honduras", () => {
  const ms = parseBusinessDueMs("2026-11-07", "17:00");
  assert.equal(ms, Date.parse("2026-11-07T17:00:00-06:00"));
});

test("viewerDueToStored convierte la hora local del usuario a Honduras", () => {
  // Buenos Aires UTC-3 → Honduras UTC-6 = -3h
  const stored = viewerDueToStored({
    date: "2026-11-07",
    time: "17:00",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  assert.equal(stored.date, "2026-11-07");
  assert.equal(stored.time, "14:00");
});

test("storedDueToViewer adapta la hora guardada a la zona de quien abre", () => {
  const local = storedDueToViewer({
    date: "2026-11-07",
    time: "14:00",
    timeZone: "America/Argentina/Buenos_Aires",
  });
  assert.equal(local.date, "2026-11-07");
  assert.equal(local.time, "17:00");
});

test("roundtrip local -> Honduras -> local conserva el instante", () => {
  const stored = viewerDueToStored({
    date: "2026-11-07",
    time: "09:30",
    timeZone: "Europe/Madrid",
  });
  const local = storedDueToViewer({
    ...stored,
    timeZone: "Europe/Madrid",
  });
  assert.equal(local.date, "2026-11-07");
  assert.equal(local.time, "09:30");
});
