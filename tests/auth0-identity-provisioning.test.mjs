import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("application identity provisioning uses the server-only service-role client", () => {
  const provision = read("../src/lib/supabase/provision-identity.ts");
  const admin = read("../src/lib/supabase/admin.ts");

  assert.match(provision, /import ["']server-only["']/);
  assert.match(provision, /createSupabaseAdminClient/);
  assert.match(provision, /from\(["']app_users["']\)\s*\.upsert/);
  assert.match(provision, /onConflict:\s*["']auth_subject["']/);
  assert.match(admin, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(admin, /createClient<Database>/);
});

test("request-scoped Supabase client never writes app_users with the publishable key", () => {
  const server = read("../src/lib/supabase/server.ts");

  assert.match(server, /await provisionApplicationIdentity\(session\.user\)/);
  assert.doesNotMatch(server, /from\(["']app_users["']\)\s*\.upsert/);
  assert.match(server, /accessToken:\s*async\s*\(\)\s*=>\s*idToken/);
});
