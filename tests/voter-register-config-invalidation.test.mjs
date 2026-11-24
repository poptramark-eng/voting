import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261124004000_invalidate_pending_register_snapshots_on_process_change.sql", import.meta.url),
  "utf8",
);

test("assurance and eligibility changes stale pending register snapshots", () => {
  assert.match(migration, /after update of assurance_tier, eligibility_mode/);
  assert.match(migration, /status = 'STALE', resolved_at = now\(\)/);
  assert.match(migration, /status = 'PENDING_APPROVAL'/);
  assert.match(migration, /process_configuration_changed/);
  assert.match(migration, /VOTER_REGISTER_FINALIZATION_STALE/);
});

test("a process with voter-register snapshot history cannot move between events", () => {
  assert.match(migration, /new\.event_id is distinct from old\.event_id/);
  assert.match(migration, /where s\.process_id = old\.id/);
  assert.match(migration, /A process with voter-register snapshot history cannot be moved to another event/);
  assert.match(migration, /before update of event_id/);
});
