import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261123231028_organization_membership_management.sql", import.meta.url),
  "utf8"
);

test("organization invitation tokens are high entropy and only their hashes are persisted", () => {
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/);
  assert.match(migration, /extensions\.digest\(convert_to\(raw_token, 'UTF8'\), 'sha256'\)/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /return jsonb_build_object\([\s\S]*?'token', raw_token/);
});

test("invitation roles and authority prevent ADMINs from appointing ADMINs or OWNERs", () => {
  assert.match(migration, /role in \('ADMIN', 'BILLING_MANAGER', 'MEMBER'\)/);
  assert.match(migration, /target_role = 'ADMIN' and caller_role <> 'OWNER'/);
  assert.match(migration, /Only an organization OWNER can invite an ADMIN/);
  assert.doesNotMatch(migration, /target_role = 'OWNER'/);
});

test("invitation acceptance requires a verified matching Auth0 email and single-use token", () => {
  assert.match(migration, /auth\.jwt\(\) ->> 'email_verified'/);
  assert.match(migration, /lower\(invitation\.email\) <> claim_email/);
  assert.match(migration, /where i\.token_hash = encode\(extensions\.digest/);
  assert.match(migration, /for update/);
  assert.match(migration, /invitation\.status <> 'PENDING'/);
  assert.match(migration, /invitation\.expires_at <= now\(\)/);
});

test("membership management preserves a last active OWNER and limits ADMIN control", () => {
  assert.match(migration, /perform 1 from public\.organizations o where o\.id = target_org for update/);
  assert.match(migration, /if existing\.role = 'OWNER'/);
  assert.match(migration, /if active_owner_count <= 1 then/);
  assert.match(migration, /The organization must retain at least one active OWNER/);
  assert.match(migration, /existing\.role = 'ADMIN' and caller_role <> 'OWNER'/);
  assert.match(migration, /target_role = 'ADMIN' and caller_role <> 'OWNER'/);
});

test("suspending or removing a member revokes scoped event and process assignments", () => {
  assert.match(migration, /if target_status <> 'ACTIVE' then[\s\S]*?update public\.event_role_assignments[\s\S]*?status = 'REVOKED'/);
  assert.match(migration, /update public\.process_role_assignments[\s\S]*?status = 'REVOKED'/);
});

test("member directory RPC exposes member contact data only after OWNER or ADMIN authorization", () => {
  assert.match(migration, /private\.list_organization_members[\s\S]*?private\.has_org_role\([\s\S]*?array\['OWNER','ADMIN'\]/);
  assert.match(migration, /public\.list_organization_members[\s\S]*?security invoker/);
  assert.match(migration, /revoke all on function public\.list_organization_members\(uuid\) from public, anon/);
});

const reactivationFix = readFileSync(
  new URL("../supabase/migrations/20261123231536_harden_organization_invitation_reactivation.sql", import.meta.url),
  "utf8"
);

test("an invitation cannot silently reactivate a removed OWNER or ADMIN", () => {
  assert.match(reactivationFix, /existing_membership\.status <> 'REMOVED'/);
  assert.match(reactivationFix, /existing_membership\.role in \('OWNER', 'ADMIN'\)/);
  assert.match(reactivationFix, /must be explicitly demoted by an OWNER before re-invitation/);
});

const existingMembershipFix = readFileSync(
  new URL("../supabase/migrations/20261123231655_harden_invitation_existing_memberships.sql", import.meta.url),
  "utf8"
);

test("invitation creation rejects already invited, suspended, active, and privileged memberships", () => {
  assert.match(existingMembershipFix, /m\.status in \('ACTIVE', 'SUSPENDED', 'INVITED'\)/);
  assert.match(existingMembershipFix, /m\.role in \('OWNER', 'ADMIN'\)/);
});

const invitationPrivacyMigration = readFileSync(
  new URL("../supabase/migrations/20261123231757_hide_invitation_token_hashes.sql", import.meta.url),
  "utf8"
);

test("invitation token hashes are not directly selectable through the public Data API", () => {
  assert.match(invitationPrivacyMigration, /revoke all on public\.organization_invitations from public, anon, authenticated/);
  assert.match(invitationPrivacyMigration, /private\.list_organization_invitations/);
  assert.match(invitationPrivacyMigration, /returns table \([\s\S]*?email text[\s\S]*?role public\.organization_member_role[\s\S]*?expires_at timestamptz/);
  assert.doesNotMatch(invitationPrivacyMigration, /token_hash text/);
  assert.match(invitationPrivacyMigration, /public\.list_organization_invitations\([\s\S]*?security invoker/);
});
