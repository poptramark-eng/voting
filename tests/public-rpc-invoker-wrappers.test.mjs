import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261124001147_move_authenticated_rpc_implementations_private.sql", import.meta.url),
  "utf8",
);

const functions = [
  "approve_process_workflow_request",
  "assign_event_role",
  "assign_process_role",
  "close_expired_process",
  "create_organization",
  "decide_voter_pii_access_request",
  "emergency_suspend_process",
  "open_scheduled_process",
  "read_voter_register_entries",
  "request_process_resumption",
  "request_process_termination",
  "request_voter_pii_access",
  "revoke_event_role",
  "revoke_process_role",
  "revoke_voter_pii_access",
  "submit_process_for_approval",
];

test("all authenticated privileged RPCs are moved behind private implementations", () => {
  for (const name of functions) {
    assert.match(migration, new RegExp(`alter function public\\.${name}\\(`));
    assert.match(migration, new RegExp(`alter function private\\.${name}\\([\\s\\S]*?rename to ${name}_impl`));
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`));
  }
});

test("public API wrappers are SECURITY INVOKER and only authenticated users can execute them", () => {
  assert.equal((migration.match(/security invoker/g) ?? []).length, functions.length);
  assert.equal((migration.match(/grant execute on function public\./g) ?? []).length, functions.length);
  assert.equal((migration.match(/grant execute on function private\./g) ?? []).length, functions.length);
  assert.match(migration, /revoke all on function private\.[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration, /revoke all on function public\.[\s\S]*from public, anon, service_role/);
  assert.doesNotMatch(migration, /grant execute on function (public|private)\.[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /security definer/i);
});

test("private implementations retain authenticated execution and are not directly service-role exposed", () => {
  for (const name of functions) {
    assert.match(migration, new RegExp(`grant execute on function private\\.${name}_impl\\([\\s\\S]*?to authenticated`));
  }
});
