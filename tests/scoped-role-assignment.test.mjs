import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const eventRoute = read("../src/app/api/events/[eventId]/assignments/route.ts");
const eventRevoke = read("../src/app/api/events/[eventId]/assignments/[userId]/route.ts");
const processRoute = read("../src/app/api/processes/[processId]/assignments/route.ts");
const processRevoke = read("../src/app/api/processes/[processId]/assignments/[userId]/route.ts");
const eventPage = read("../src/app/dashboard/events/[eventId]/page.tsx");
const processPage = read("../src/app/dashboard/processes/[processId]/page.tsx");
const eventUi = read("../src/app/dashboard/events/[eventId]/event-role-assignments.tsx");
const processUi = read("../src/app/dashboard/processes/[processId]/process-role-assignments.tsx");

test("event assignment API accepts only the three scoped roles and delegates authorization to Supabase", () => {
  assert.match(eventRoute, /const roles: ScopedRole\[\] = \["ELECTION_MANAGER", "AUDITOR", "OBSERVER"\]/);
  assert.match(eventRoute, /supabase\.rpc\("assign_event_role"/);
  assert.match(eventRoute, /target_expires_at:/);
  assert.match(eventRoute, /auth0\.getSession\(\)/);
  assert.match(eventRevoke, /supabase\.rpc\("revoke_event_role"/);
});

test("process assignment API narrows an existing event role through the database RPC", () => {
  assert.match(processRoute, /supabase\.rpc\("assign_process_role"/);
  assert.match(processRoute, /from\("event_role_assignments"\)/);
  assert.match(processRoute, /from\("process_role_assignments"\)/);
  assert.match(processRevoke, /supabase\.rpc\("revoke_process_role"/);
});

test("only organization OWNER and ADMIN see scoped assignment administration", () => {
  assert.match(eventPage, /const canManageAssignments = \["OWNER", "ADMIN"\]\.includes\(membership\.role\)/);
  assert.match(eventPage, /canManageAssignments && \([\s\S]*?<EventRoleAssignments/);
  assert.match(processPage, /canGovern && \([\s\S]*?<ProcessRoleAssignments/);
});

test("event assignment UI shows optional expiry and revocation", () => {
  assert.match(eventUi, /type="datetime-local"/);
  assert.match(eventUi, /method: "POST"/);
  assert.match(eventUi, /method: "DELETE"/);
  assert.match(eventUi, /Revoke/);
  assert.match(eventUi, /Expiry is checked by the database/);
});

test("process assignment UI only offers event-assigned active members and supports expiry", () => {
  assert.match(processUi, /eventAssignmentByUser\.get\(member\.user_id\)\?\.status === "ACTIVE"/);
  assert.match(processUi, /type="datetime-local"/);
  assert.match(processUi, /method: "POST"/);
  assert.match(processUi, /method: "DELETE"/);
  assert.match(processUi, /cannot grant permissions the member does not already hold/);
});
