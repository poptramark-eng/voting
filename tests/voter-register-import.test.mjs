import test from "node:test";
import assert from "node:assert/strict";
import { parseVoterRegisterCsv } from "../src/lib/voter-register-import.ts";

test("parses quoted commas, escaped quotes, CRLF and optional columns", () => {
  const result = parseVoterRegisterCsv('name,reference,email,phone\r\n"Jane, A.",R-1,JANE@example.test,0712345678\r\n"Sam ""The Vote""",R-2,,');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rows, [
    { display_name: "Jane, A.", external_reference: "R-1", contact_email: "jane@example.test", contact_phone: "0712345678" },
    { display_name: 'Sam "The Vote"', external_reference: "R-2", contact_email: null, contact_phone: null },
  ]);
});

test("rejects malformed CSV and inconsistent column counts", () => {
  assert.equal(parseVoterRegisterCsv('name,email\n"Unclosed,x').ok, false);
  assert.equal(parseVoterRegisterCsv("name,email\nJane").ok, false);
});

test("requires names and validates email and field lengths", () => {
  assert.equal(parseVoterRegisterCsv("email\na@example.test").ok, false);
  assert.equal(parseVoterRegisterCsv("name,email\nJane,not-an-email").ok, false);
  assert.equal(parseVoterRegisterCsv("name\n" + "x".repeat(201)).ok, false);
});

test("rejects duplicate external references case-insensitively", () => {
  const result = parseVoterRegisterCsv("name,reference\nJane,ABC\nJohn,abc");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Duplicate external reference/);
});

test("rejects unsupported columns, empty files, oversized files and more than 500 rows", () => {
  assert.equal(parseVoterRegisterCsv("").ok, false);
  assert.equal(parseVoterRegisterCsv("name,ballot_choice\nJane,A").ok, false);
  assert.equal(parseVoterRegisterCsv("x".repeat(1_000_001)).ok, false);
  const csv = "name\n" + Array.from({ length: 501 }, (_, i) => `Voter ${i}`).join("\n");
  assert.equal(parseVoterRegisterCsv(csv).ok, false);
});
