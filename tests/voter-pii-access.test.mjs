import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261123200600_voter_pii_access_grants.sql", import.meta.url),
  "utf8"
);

test("only election managers and auditors receive the voter PII permission", () => {
  assert.match(migration, /\('ELECTION_MANAGER', 'voter_pii\.read'\)/);
  assert.match(migration, /\('AUDITOR', 'voter_pii\.read'\)/);
  assert.doesNotMatch(migration, /\('OBSERVER', 'voter_pii\.read'\)/);
});

test("assurance approval thresholds are one, two, two and three", () => {
  assert.match(migration, /when 'STANDARD' then 1::smallint\s+when 'ENHANCED' then 2::smallint\s+when 'HIGH' then 2::smallint\s+when 'CRITICAL' then 3::smallint/);
});

test("grant maximum lifetimes are tier bounded", () => {
  assert.match(migration, /when 'STANDARD' then interval '30 days'/);
  assert.match(migration, /when 'ENHANCED' then interval '7 days'/);
  assert.match(migration, /when 'HIGH' then interval '24 hours'/);
  assert.match(migration, /when 'CRITICAL' then interval '4 hours'/);
});

test("approval ledger enforces distinct approvers and prevents requester self-approval", () => {
  assert.match(migration, /unique \(request_id, approver_user_id\)/);
  assert.match(migration, /if caller_id = request_row\.requested_by then/);
  assert.match(migration, /required_approvals/);
});

test("grant scope, categories, purpose and expiry are immutable request inputs", () => {
  assert.match(migration, /scope_type text not null check \(scope_type in \('EVENT', 'PROCESS'\)\)/);
  assert.match(migration, /permitted_categories text\[\] not null/);
  assert.match(migration, /purpose text not null check/);
  assert.match(migration, /requested_expires_at timestamptz not null/);
  assert.match(migration, /target_expires_at > now\(\) \+ private\.max_voter_pii_grant_lifetime/);
});

test("direct authenticated SELECT is revoked and register reads go through an audited RPC", () => {
  assert.match(migration, /revoke select on public\.voter_register_entries from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.read_voter_register_entries/);
  assert.match(migration, /'VOTER_PII_ACCESSED'/);
  assert.match(migration, /'VOTER_PII_EXPORTED'/);
});

test("scoped PII access fails closed when assignment or assurance no longer covers the process", () => {
  assert.match(migration, /private\.has_process_permission\(target_process, 'voter_pii\.read'\)/);
  assert.match(migration, /private\.resolve_voter_pii_assurance\(e\.id, null\)/);
  assert.match(migration, /r\.expires_at > now\(\)/);
});

test("assurance increases suspend active grants at event and process scope", () => {
  assert.match(migration, /status in \('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'REVOKED', 'STALE'\)/);
  assert.match(migration, /create trigger voting_processes_suspend_voter_pii_grants/);
  assert.match(migration, /create trigger voting_events_suspend_voter_pii_grants/);
  assert.match(migration, /set status = 'SUSPENDED'/);
});

test("a previous approver who loses active OWNER or ADMIN status invalidates pending activation", () => {
  assert.match(migration, /A prior approver is no longer an active organization OWNER or ADMIN/);
  assert.match(migration, /m\.status = 'ACTIVE'/);
  assert.match(migration, /m\.role in \('OWNER', 'ADMIN'\)/);
});

test("all public SECURITY DEFINER workflow RPCs revoke PUBLIC and anon execution", () => {
  for (const name of [
    "request_voter_pii_access",
    "decide_voter_pii_access_request",
    "revoke_voter_pii_access",
    "read_voter_register_entries",
  ]) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    assert.notEqual(start, -1, `missing function ${name}`);
    const next = migration.indexOf("\n$function$;", start);
    const revoke = migration.indexOf(`revoke all on function public.${name}`, next);
    assert.notEqual(revoke, -1, `missing privilege revocation for ${name}`);
    assert.match(migration.slice(revoke, revoke + 400), /from public, anon/);
  }
});
