import assert from "node:assert/strict";
import test from "node:test";
import { SUPER_ADMIN_EMAILS } from "../../src/app/constants/app.constants.js";
import { DEFAULT_SUPER_ADMIN_EMAILS } from "../config/bootstrap.js";
import { ROLE_DEFINITIONS } from "../constants/permissions.js";
import {
  assertTaskPrivilegedFields,
  collectReportRecipientEmails,
  hasPermission,
} from "./permissions.js";

const TASK_CREATE_PERMISSIONS = [
  "create_account_tasks",
  "create_editing_tasks",
  "create_management_tasks",
];

const expectForbidden = (fn, code) => {
  try {
    fn();
  } catch (error) {
    if (error.status === 403 && error.code === code) return;
    throw error;
  }
  assert.fail("expected forbidden error");
};

test("operational roles can create tasks while viewer remains read-only", () => {
  for (const role of Object.keys(ROLE_DEFINITIONS).filter((item) => item !== "viewer")) {
    for (const permission of TASK_CREATE_PERMISSIONS) {
      assert.equal(
        hasPermission({ role, isActive: true }, permission),
        true,
        `${role} must include ${permission}`,
      );
    }
  }
  for (const permission of TASK_CREATE_PERMISSIONS) {
    assert.equal(hasPermission({ role: "viewer", isActive: true }, permission), false);
  }
});

test("inactive organization users cannot create tasks", () => {
  for (const role of Object.keys(ROLE_DEFINITIONS)) {
    for (const permission of TASK_CREATE_PERMISSIONS) {
      assert.equal(hasPermission({ role, isActive: false }, permission), false);
    }
  }
});

test("no privileged identities are shipped in application source", () => {
  assert.deepEqual(SUPER_ADMIN_EMAILS, []);
  assert.deepEqual(DEFAULT_SUPER_ADMIN_EMAILS, []);
});

test("create_tasks pack grants task permissions to viewers", () => {
  const viewer = { role: "viewer", isActive: true, permissionPacks: ["create_tasks"] };
  for (const permission of TASK_CREATE_PERMISSIONS) {
    assert.equal(hasPermission(viewer, permission), true);
  }
  assert.equal(hasPermission(viewer, "assign_tasks"), false);
  assert.equal(hasPermission(viewer, "edit_due_date"), false);
});

test("operations can change due dates and assignees without extra packs", () => {
  const operations = { role: "operations", isActive: true };
  assert.equal(hasPermission(operations, "assign_tasks"), true);
  assert.equal(hasPermission(operations, "edit_due_date"), true);
  assert.equal(hasPermission(operations, "receive_reports"), false);
});

test("managers cannot change due dates or assignees unless the pack is assigned", () => {
  const manager = { role: "manager", isActive: true };
  assert.equal(hasPermission(manager, "assign_tasks"), false);
  assert.equal(hasPermission(manager, "edit_due_date"), false);
  assert.equal(
    hasPermission({ ...manager, permissionPacks: ["assign_tasks", "edit_due_date"] }, "assign_tasks"),
    true,
  );
  assert.equal(
    hasPermission({ ...manager, permissionPacks: ["assign_tasks", "edit_due_date"] }, "edit_due_date"),
    true,
  );
});

test("assertTaskPrivilegedFields blocks due date and assignee edits without packs", () => {
  const existing = {
    date: "2026-10-02",
    time: "09:00",
    contextId: "user-1",
    assignees: ["user-1"],
    assigneeUserId: "user-1",
    status: "pendiente",
  };
  const manager = { role: "manager", isActive: true };

  expectForbidden(
    () => assertTaskPrivilegedFields({
      collectionName: "account_tasks",
      existing,
      incoming: { date: "2026-10-03" },
      actor: manager,
    }),
    "tasks/due-date-forbidden",
  );
  expectForbidden(
    () => assertTaskPrivilegedFields({
      collectionName: "account_tasks",
      existing,
      incoming: { contextId: "user-2" },
      actor: manager,
    }),
    "tasks/assign-forbidden",
  );

  assert.doesNotThrow(() => assertTaskPrivilegedFields({
    collectionName: "account_tasks",
    existing,
    incoming: { status: "en_proceso" },
    actor: manager,
  }));
  assert.doesNotThrow(() => assertTaskPrivilegedFields({
    collectionName: "account_tasks",
    existing,
    incoming: { date: "2026-10-03", contextId: "user-2" },
    actor: { role: "operations", isActive: true },
  }));
  assert.doesNotThrow(() => assertTaskPrivilegedFields({
    collectionName: "account_tasks",
    existing,
    incoming: { date: "2026-10-03" },
    actor: { role: "manager", isActive: true, permissionPacks: ["edit_due_date"] },
  }));
});

test("collectReportRecipientEmails includes packed users and the agency inbox", () => {
  const emails = collectReportRecipientEmails({
    users: [
      { role: "manager", isActive: true, email: "ana@example.com", permissionPacks: ["receive_reports"] },
      { role: "operations", isActive: true, email: "ops@example.com" },
      { role: "super_admin", isActive: true, email: "admin@example.com" },
      { role: "manager", isActive: false, email: "old@example.com", permissionPacks: ["receive_reports"] },
    ],
    extraEmails: ["reportes@example.com"],
  });
  assert.deepEqual(emails.sort(), ["admin@example.com", "ana@example.com", "reportes@example.com"]);
});

