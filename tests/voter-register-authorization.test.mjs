import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261124090000_allow_election_managers_to_manage_draft_voter_register.sql", import.meta.url),
  "utf8"
);

test("only Election Managers receive the draft voter register management permission", () => {
  assert.match(migration, /\('ELECTION_MANAGER', 'voter_register\.manage'\)/);
  assert.match(migration, /private\.has_process_permission\(p\.id, 'voter_register\.manage'\)/);
});

test("voter register writes are limited to authorized managers and DRAFT processes", () => {
  assert.match(migration, /create policy "authorized managers can add draft voter register entries"/);
  assert.match(migration, /create policy "authorized managers can update draft voter register entries"/);
  assert.match(migration, /p\.status = 'DRAFT'/);
  assert.match(migration, /created_by = \(select private\.current_app_user_id\(\)\)/);
});

test("updates cannot rewrite voter identity, process scope, creator or provenance", () => {
  for (const field of ["id", "process_id", "created_by", "created_at", "source"]) {
    assert.match(migration, new RegExp(`new\\.${field} is distinct from old\\.${field}`));
  }
  assert.match(migration, /new\.updated_at := now\(\)/);
});

test("register mutations create PII-minimized process audit events", () => {
  assert.match(migration, /create trigger voter_register_entries_audit_changes/);
  assert.match(migration, /'VOTER_REGISTER_ENTRY_CREATED'/);
  assert.match(migration, /'VOTER_REGISTER_ENTRY_UPDATED'/);
  assert.match(migration, /'changed_fields', changed_fields/);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]{0,500}new\.contact_email/);
  assert.match(migration, /revoke all on function private\.audit_voter_register_entry_change\(\)\s+from public, anon, authenticated/);
});
