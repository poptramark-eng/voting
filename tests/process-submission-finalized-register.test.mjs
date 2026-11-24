import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261124083208_require_finalized_voter_register_before_process_submission.sql", import.meta.url),
  "utf8",
);

test("managed-register processes require an approved snapshot of the current register revision", () => {
  assert.match(migration, /eligibility_mode in \('MANAGED_REGISTER', 'COMBINED'\)/);
  assert.match(migration, /s\.status = 'FINALIZED'/);
  assert.match(migration, /s\.register_revision = process_row\.voter_register_revision/);
  assert.match(migration, /s\.eligible_count > 0/);
  assert.match(migration, /A finalized voter register matching the current register revision is required before process submission/);
});

test("the submission guard preserves existing schedule, ballot and approval workflow checks", () => {
  assert.match(migration, /A valid future opening and closing schedule is required/);
  assert.match(migration, /At least one contest with a ballot item is required/);
  assert.match(migration, /private\.create_process_workflow_request/);
  assert.match(migration, /PROCESS_SUBMITTED_FOR_APPROVAL/);
});
