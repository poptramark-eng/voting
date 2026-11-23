import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const processUi = readFileSync(new URL("../src/app/dashboard/processes/[processId]/process-role-assignments.tsx", import.meta.url), "utf8");


test("process assignment UI resolves the newest event assignment when history contains older revoked rows", () => {
  assert.match(processUi, /eventAssignments\.slice\(\)\.reverse\(\)\.map\(\(assignment\) => \[assignment\.user_id, assignment\]\)/);
});
