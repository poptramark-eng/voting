import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = [
  "../src/app/api/events/[eventId]/processes/route.ts",
  "../src/app/api/processes/[processId]/contests/route.ts",
  "../src/app/api/contests/[contestId]/items/route.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

test("RLS-protected create routes avoid INSERT RETURNING", () => {
  for (const source of files) {
    assert.match(source, /crypto\.randomUUID\(\)/);
    assert.match(source, /\.insert\(\{/);
    assert.match(source, /id:\s*(?:processId|contestId|itemId)/);
    assert.doesNotMatch(source, /\.insert\(\{[\s\S]*?\}\)\s*\.select\(/);
  }
});

test("RLS-protected create routes read inserted rows in a separate scoped query", () => {
  for (const source of files) {
    assert.match(source, /\.select\([\s\S]*?\)\s*\.eq\("id",\s*(?:processId|contestId|itemId)\)\s*\.single\(\)/);
  }
});
