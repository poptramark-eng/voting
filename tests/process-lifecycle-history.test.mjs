import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../src/app/dashboard/processes/[processId]/page.tsx", import.meta.url),
  "utf8",
);

test("process workspace displays recent lifecycle history to users with lifecycle-read permission", () => {
  assert.match(page, /from\("process_lifecycle_events"\)/);
  assert.match(page, /\.eq\("process_id", processId\)/);
  assert.match(page, /\.order\("occurred_at", \{ ascending: false \}\)/);
  assert.match(page, /\.limit\(30\)/);
  assert.match(page, /canReadLifecycle \? await supabase\.from\("process_lifecycle_events"\)/);
  assert.match(page, /Lifecycle history/);
  assert.match(page, /event\.from_status\.replaceAll/);
  assert.match(page, /event\.to_status\.replaceAll/);
  assert.match(page, /event\.reason/);
  assert.match(page, /event\.occurred_at/);
});

test("lifecycle history is not rendered to users without lifecycle-read permission", () => {
  assert.match(page, /\{canReadLifecycle \? \([\s\S]*Lifecycle history[\s\S]*\) : null\}/);
});
