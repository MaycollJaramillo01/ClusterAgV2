import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays } from "./date.js";

test("addBusinessDays salta sabados y domingos", () => {
  assert.equal(addBusinessDays("2026-10-02", 2), "2026-10-06");
  assert.equal(addBusinessDays("2026-10-02", 1), "2026-10-05");
  assert.equal(addBusinessDays("2026-10-05", 2), "2026-10-07");
});

test("addBusinessDays conserva la fecha si no hay desplazamiento", () => {
  assert.equal(addBusinessDays("2026-10-02", 0), "2026-10-02");
  assert.equal(addBusinessDays("", 2), "");
});
