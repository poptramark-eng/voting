import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261124001958_redact_voter_register_snapshot_digests.sql");
const approvalCountMigration = read("../supabase/migrations/20261124002027_count_approved_snapshot_decisions.sql");
const route = read("../src/app/api/processes/[processId]/voter-register/finalization/route.ts");
const workspace = read("../src/app/dashboard/processes/[processId]/voter-register-finalization.tsx");

test("snapshot digest and requester identifiers are not exposed through the table API", () => {
  assert.match(migration, /revoke all on table public\.voter_register_snapshots from public, anon, authenticated/);
  assert.match(migration, /organization governors can read register snapshot metadata/);
  assert.match(migration, /requested_by_is_current_user boolean/);
  assert.doesNotMatch(route, /\.from\(["']voter_register_snapshots["']\)/);
  assert.doesNotMatch(route, /integrity_digest|requested_by|reopened_by/);
  assert.doesNotMatch(workspace, /integrity_digest|requested_by: string|reopened_by/);
});

test("summary RPC is scoped and returns only minimized metadata", () => {
  assert.match(migration, /private\.current_app_user_id\(\)/);
  assert.match(migration, /private\.has_process_permission\(target_process,\s*'process\.read'\)/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.read_voter_register_snapshot_summaries\(uuid\) from public,\s*anon,\s*service_role/);
  assert.match(route, /read_voter_register_snapshot_summaries/);
  assert.match(workspace, /requested_by_is_current_user/);
  assert.doesNotMatch(migration, /integrity_digest|snapshot_entry_id|contact_email|contact_phone/);
});

test("approval progress counts affirmative decisions only", () => {
  assert.match(approvalCountMigration, /a\.decision='APPROVE'/);
});
