import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../supabase/migrations/20261123234858_voter_register_finalization_snapshots.sql");
const rpcHardening = read("../supabase/migrations/20261123235032_harden_voter_register_finalization_rpc.sql");
const configHardening = read("../supabase/migrations/20261123235249_harden_finalized_register_configuration.sql");
const grantBinding = read("../supabase/migrations/20261123235555_bind_snapshot_to_pii_grant.sql");
const piiMinimization = read("../supabase/migrations/20261123235845_minimize_voter_snapshot_pii.sql");
const workspace = read("../src/app/dashboard/processes/[processId]/voter-register-finalization.tsx");
const processPage = read("../src/app/dashboard/processes/[processId]/page.tsx");
const finalizationRoute = read("../src/app/api/processes/[processId]/voter-register/finalization/route.ts");
const decisionRoute = read("../src/app/api/processes/[processId]/voter-register/finalization/[snapshotId]/decision/route.ts");
const reopenRoute = read("../src/app/api/processes/[processId]/voter-register/finalization/[snapshotId]/reopen/route.ts");
const databaseTypes = read("../src/types/database.types.ts");

test("finalization creates immutable versioned identity snapshots with deterministic SHA-256 digest", () => {
  assert.match(schema, /create table public\.voter_register_snapshots/);
  assert.match(schema, /create table public\.voter_register_snapshot_entries/);
  assert.match(schema, /identity_payload jsonb not null/);
  assert.match(schema, /extensions\.digest\(convert_to\(payload, 'UTF8'\), 'sha256'\)/);
  assert.match(schema, /jsonb_agg\([\s\S]*order by v\.id/);
  assert.match(schema, /unique \(process_id, version\)/);
  assert.match(schema, /integrity_digest text not null check \(integrity_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test("finalization refuses unresolved or ambiguous eligibility records", () => {
  assert.match(schema, /pending_count > 0/);
  assert.match(schema, /eligible_count = 0/);
  assert.match(schema, /duplicate_reference_count > 0/);
  assert.match(schema, /eligibility_status = 'ELIGIBLE'[\s\S]*group by lower\(trim\(external_reference\)\)/);
});

test("scoped managers need active PII grants for every populated identity category", () => {
  assert.match(schema, /private\.active_voter_pii_grant\(target_process\)/);
  assert.match(schema, /required_pii_categories <@ active_grant_categories/);
  assert.match(schema, /An active voter PII grant covering every populated identity category is required/);
  assert.match(schema, /private\.has_org_role\([\s\S]*array\['OWNER','ADMIN'\]/);
});

test("register mutation, approval and reopening share a process-first lock order", () => {
  assert.match(schema, /from public\.voting_processes p[\s\S]*where p\.id = target_process[\s\S]*for update/);
  assert.match(schema, /update public\.voter_register_snapshots[\s\S]*set status = 'STALE'/);
  assert.match(schema, /Lock order is always process first, snapshot second/);
  assert.match(schema, /Match the lock order used by register edits and approval decisions/);
  assert.match(schema, /The voter register is finalized; request an audited reopening/);
});

test("approval threshold, requester independence and audited reopening are enforced", () => {
  assert.match(schema, /private\.required_process_approvals\(process_row\.assurance_tier\)/);
  assert.match(schema, /caller_id = snapshot_row\.requested_by/);
  assert.match(schema, /unique \(snapshot_id, approver_user_id\)/);
  assert.match(schema, /VOTER_REGISTER_FINALIZED/);
  assert.match(schema, /VOTER_REGISTER_REOPENED/);
});

test("snapshot PII is not directly readable and public RPCs use invoker wrappers", () => {
  assert.match(schema, /revoke all on public\.voter_register_snapshot_entries from public, anon, authenticated/);
  assert.match(rpcHardening, /alter function public\.request_voter_register_finalization\(uuid, text\) set schema private/);
  assert.match(rpcHardening, /security invoker/);
  assert.match(rpcHardening, /grant execute on function private\.request_voter_register_finalization_impl\(uuid, text\)\s+to authenticated/);
  assert.match(rpcHardening, /no direct API access to voter snapshot PII/);
  assert.doesNotMatch(rpcHardening, /security definer/i);
});



test("immutable snapshots copy only eligible voter PII while hashing aggregate eligibility counts", () => {
  assert.match(piiMinimization, /'eligible_voters'/);
  assert.match(piiMinimization, /filter \(where v\.eligibility_status = 'ELIGIBLE'\)/);
  assert.match(piiMinimization, /and v\.eligibility_status = 'ELIGIBLE'/);
  assert.match(piiMinimization, /'rejected_count', rejected_count/);
  assert.match(piiMinimization, /'revoked_count', revoked_count/);
  assert.match(piiMinimization, /where process_id = target_process and eligibility_status = 'ELIGIBLE'/);
});

test("pending snapshots remain bound to the exact active PII grant used to create them", () => {
  assert.match(grantBinding, /create table private\.voter_register_snapshot_pii_grants/);
  assert.match(grantBinding, /pii_grant_id uuid not null/);
  assert.match(grantBinding, /private\.user_has_process_permission\([\s\S]*'voter_pii\.read'/);
  assert.match(grantBinding, /r\.status = 'ACTIVE'/);
  assert.match(grantBinding, /r\.expires_at > now\(\)/);
  assert.match(grantBinding, /pii_grant_inactive_or_scope_expired/);
  assert.match(grantBinding, /set status = 'STALE'/);
});

test("finalized snapshots block process eligibility-mode and assurance drift", () => {
  assert.match(configHardening, /guard_finalized_voter_register_configuration/);
  assert.match(configHardening, /new\.assurance_tier is distinct from old\.assurance_tier/);
  assert.match(configHardening, /new\.eligibility_mode is distinct from old\.eligibility_mode/);
  assert.match(configHardening, /s\.assurance_tier = new\.assurance_tier/);
  assert.match(configHardening, /A current, approved voter register snapshot matching the process assurance tier is required/);
});

test("finalization APIs authenticate, validate UUIDs and delegate authorization to database RPCs", () => {
  for (const route of [finalizationRoute, decisionRoute, reopenRoute]) {
    assert.match(route, /auth0\.getSession\(\)/);
    assert.match(route, /Authentication required/);
    assert.match(route, /Cache-Control/);
  }
  assert.match(finalizationRoute, /request_voter_register_finalization/);
  assert.match(decisionRoute, /decide_voter_register_finalization/);
  assert.match(reopenRoute, /reopen_voter_register_snapshot/);
  assert.match(decisionRoute, /eq\("process_id", processId\)/);
  assert.match(reopenRoute, /eq\("process_id", processId\)/);
});

test("process workspace exposes snapshot governance without exposing copied PII", () => {
  assert.match(processPage, /VoterRegisterFinalization/);
  assert.match(workspace, /Submit for independent approval/);
  assert.match(workspace, /Approve snapshot/);
  assert.match(workspace, /Reopen register/);
  assert.match(workspace, /integrity_digest/);
  assert.doesNotMatch(workspace, /identity_payload|contact_email|contact_phone/);
  assert.match(databaseTypes, /voter_register_snapshots:/);
  assert.match(databaseTypes, /voter_register_revision: number/);
});
