import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261123225000_add_audited_voter_eligibility_review.sql", import.meta.url),
  "utf8"
);

test("direct voter-register updates and deletes are revoked", () => {
  assert.match(migration, /revoke update, delete on public\.voter_register_entries from authenticated/);
  assert.match(migration, /revoke insert, update, delete on public\.voter_register_entries from public, anon/);
  assert.match(migration, /grant insert on public\.voter_register_entries to authenticated/);
  assert.match(migration, /drop policy if exists "authorized managers can update draft voter register entries"/);
});

test("eligibility review is limited to authorized draft managers and active PII grants", () => {
  assert.match(migration, /private\.can_manage_draft_voter_register\(target_process\)/);
  assert.match(migration, /private\.active_voter_pii_grant\(target_process\)/);
  assert.match(migration, /'VOTER_NAME' = any\(g\.permitted_categories\)/);
  assert.match(migration, /process_status <> 'DRAFT'/);
});

test("eligibility transitions are constrained and require a reason", () => {
  assert.match(migration, /target_status not in \('ELIGIBLE', 'REJECTED', 'REVOKED'\)/);
  assert.match(migration, /current_status = 'PENDING' and target_status not in \('ELIGIBLE', 'REJECTED'\)/);
  assert.match(migration, /current_status = 'ELIGIBLE' and target_status <> 'REVOKED'/);
  assert.match(migration, /length\(trim\(target_reason\)\) < 10/);
});

test("eligibility decisions create an audit record without including voter PII", () => {
  assert.match(migration, /'VOTER_ELIGIBILITY_REVIEWED'/);
  assert.match(migration, /'from_status', current_status/);
  assert.match(migration, /'to_status', target_status/);
  assert.match(migration, /'reason', trim\(target_reason\)/);
  assert.doesNotMatch(migration, /jsonb_build_object\([\s\S]{0,700}v\.display_name/);
});

test("public RPC wrapper is invoker-security and delegates to a private definer function", () => {
  assert.match(migration, /function private\.update_voter_register_eligibility\([\s\S]*?security definer[\s\S]*?set search_path = ''/);
  assert.match(migration, /function public\.update_voter_register_eligibility\([\s\S]*?security invoker[\s\S]*?private\.update_voter_register_eligibility/);
  assert.match(migration, /revoke all on function public\.update_voter_register_eligibility\(uuid, uuid, text, text\)\s+from public, anon/);
});
