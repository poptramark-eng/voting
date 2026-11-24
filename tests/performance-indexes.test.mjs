import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261124001626_index_remaining_foreign_keys_and_optimize_app_users_rls.sql", import.meta.url),
  "utf8",
);

test("all 15 remaining foreign keys receive a covering index", () => {
  assert.equal((migration.match(/create index if not exists/g) ?? []).length, 15);
  for (const indexName of [
    "event_role_assignments_assigned_by_idx",
    "event_role_assignments_user_idx",
    "payment_transactions_initiated_by_idx",
    "process_lifecycle_events_actor_idx",
    "process_lifecycle_events_workflow_request_idx",
    "process_role_assignments_assigned_by_idx",
    "process_role_assignments_event_idx",
    "process_role_assignments_organization_idx",
    "process_role_assignments_user_idx",
    "process_workflow_approvals_approver_idx",
    "process_workflow_requests_requested_by_idx",
    "voter_pii_access_approvals_approver_idx",
    "voter_pii_access_requests_process_idx",
    "voter_pii_access_requests_requested_by_idx",
    "voter_pii_access_requests_revoked_by_idx",
  ]) {
    assert.ok(migration.includes(indexName), `missing FK index: ${indexName}`);
  }
});

test("app_users RLS evaluates the Auth0 JWT once per statement", () => {
  assert.equal((migration.match(/\(\(select auth\.jwt\(\)\) ->>/g) ?? []).length, 8);
  assert.match(migration, /users can read their own application identity/);
  assert.match(migration, /users can provision their own application identity/);
  assert.match(migration, /users can sync their own application identity/);
});
