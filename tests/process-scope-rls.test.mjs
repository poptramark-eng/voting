import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261123224319_fix_process_scope_rls_and_register_writes.sql", import.meta.url),
  "utf8"
);

test("process visibility and draft updates authorize against the process ID", () => {
  assert.match(migration, /private\.can_access_voting_process\(id, 'process\.read'\)/);
  assert.match(migration, /private\.can_access_voting_process\(id, 'process\.update'\)/);
  assert.doesNotMatch(migration, /private\.has_process_permission\(e\.id/);
});

test("process access helper resolves organization and scoped permission in a private definer function", () => {
  assert.match(migration, /function private\.can_access_voting_process\([\s\S]*?security definer[\s\S]*?set search_path = ''/);
  assert.match(migration, /private\.has_org_role\([\s\S]*?private\.has_process_permission\(p\.id, target_permission\)/);
  assert.match(migration, /revoke all on function private\.can_access_voting_process\(uuid, text\)\s+from public, anon/);
  assert.match(migration, /grant execute on function private\.can_access_voting_process\(uuid, text\)\s+to authenticated/);
});

test("voter register write policies use the private draft authorization helper", () => {
  assert.match(migration, /function private\.can_manage_draft_voter_register\([\s\S]*?p\.status = 'DRAFT'[\s\S]*?private\.has_process_permission\(p\.id, 'voter_register\.manage'\)/);
  assert.match(migration, /created_by = \(select private\.current_app_user_id\(\)\)\s+and private\.can_manage_draft_voter_register\(process_id\)/);
  assert.match(migration, /using \(\s*private\.can_manage_draft_voter_register\(process_id\)\s*\)\s+with check \(\s*private\.can_manage_draft_voter_register\(process_id\)/);
});
