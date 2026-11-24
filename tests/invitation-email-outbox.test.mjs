import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("invitation delivery stores tokens encrypted and queues atomically", () => {
  const migration = read("../supabase/migrations/20261124005816_transactional_invitation_email_outbox.sql");

  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /pgp_sym_encrypt\(raw_token, encryption_key\)/);
  assert.match(migration, /digest\(convert_to\(raw_token/);
  assert.match(migration, /insert into public\.organization_invitation_email_outbox/);
  assert.match(migration, /for update of o skip locked/);
  assert.match(migration, /grant execute on function public\.claim_organization_invitation_email_outbox[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.claim_organization_invitation_email_outbox\(integer\)[\s\S]*to authenticated/);
});

test("terminal invitation changes cancel queued delivery and remove encrypted tokens", () => {
  const migration = read("../supabase/migrations/20261124010001_cancel_terminal_invitation_email_delivery.sql");

  assert.match(migration, /new\.status in \('ACCEPTED', 'REVOKED', 'EXPIRED'\)/);
  assert.match(migration, /set status = 'CANCELLED'/);
  assert.match(migration, /delete from private\.organization_invitation_delivery_secrets/);
  assert.match(migration, /is_organization_invitation_email_lease_valid/);
});

test("Resend worker is cron-protected, checks leases, and uses a stable idempotency key", () => {
  const worker = read("../src/app/api/internal/notifications/process-invitations/route.ts");

  assert.match(worker, /CRON_SECRET/);
  assert.match(worker, /process\.env\.VERCEL_ENV === "preview"/);
  assert.match(worker, /process\.env\.VERCEL_URL/);
  assert.match(worker, /process\.env\.APP_BASE_URL/);
  assert.match(worker, /createSupabaseAdminClient/);
  assert.match(worker, /is_organization_invitation_email_lease_valid/);
  assert.match(worker, /["']Idempotency-Key["']:\s*item\.outbox_id/);
  assert.match(worker, /fail_organization_invitation_email_outbox/);
  assert.match(worker, /complete_organization_invitation_email_outbox/);
});

test("invitation API queues email while retaining the one-time manual link fallback", () => {
  const route = read("../src/app/api/organizations/[organizationId]/members/route.ts");
  const ui = read("../src/app/dashboard/organizations/[organizationId]/organization-members.tsx");

  assert.match(route, /delivery: "QUEUED"/);
  assert.match(route, /process-invitations/);
  assert.match(route, /new URL\([\s\S]*request\.url\)/);
  assert.doesNotMatch(route, /new URL\([\s\S]*appBaseUrl\)/);
  assert.match(route, /AbortSignal\.timeout\(8000\)/);
  assert.match(ui, /queued for email delivery/);
  assert.match(ui, /Invitation link/);
});

test("Vercel Schedules recovers queued invitation emails every fifteen minutes", () => {
  const config = JSON.parse(read("../vercel.json"));

  assert.equal(Object.keys(config.schedules).length, 1);
  assert.equal(config.schedules["invitation-email-worker"].path, "/api/internal/notifications/process-invitations");
  assert.equal(config.schedules["invitation-email-worker"].requestMethod, "GET");
  assert.equal(config.schedules["invitation-email-worker"].schedule, "*/15 * * * *");
});
