import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const schemaDefaults = read("../supabase/migrations/20261124002839_restrict_public_default_privileges.sql");
const functionDefaults = read("../supabase/migrations/20261124002923_revoke_default_public_function_execute.sql");
const authzDocs = read("../docs/security/authentication-and-authorization.md");

test("existing public tables, sequences and functions lose anonymous grants", () => {
  assert.match(schemaDefaults, /revoke all on all tables in schema public from anon/);
  assert.match(schemaDefaults, /revoke all on all sequences in schema public from anon/);
  assert.match(schemaDefaults, /revoke execute on all functions in schema public from anon/);
});

test("future public tables and sequences require explicit anon/authenticated grants", () => {
  assert.match(schemaDefaults, /alter default privileges for role postgres in schema public\s+revoke all on tables from anon, authenticated/);
  assert.match(schemaDefaults, /alter default privileges for role postgres in schema public\s+revoke all on sequences from anon, authenticated/);
});

test("future functions do not inherit PUBLIC or role-wide EXECUTE grants", () => {
  assert.match(schemaDefaults, /revoke execute on functions from public, anon, authenticated, service_role/);
  assert.match(functionDefaults, /alter default privileges for role postgres\s+revoke execute on functions from public/);
});

test("security documentation records the explicit-grant rule and disabled anonymous voting surface", () => {
  assert.match(authzDocs, /anonymous ballot|anonymous public|public anonymous/i);
  assert.match(authzDocs, /explicit grants/i);
});
