import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVoterRegisterCsv,
  serializeVoterRegisterCsv,
} from "../src/lib/voter-register-import.ts";

test("parses quoted commas, escaped quotes, CRLF and optional columns", () => {
  const result = parseVoterRegisterCsv('name,reference,email,phone\r\n"Jane, A.",R-1,JANE@example.test,0712345678\r\n"Sam ""The Vote""",R-2,,');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.rows, [
    { display_name: "Jane, A.", external_reference: "R-1", contact_email: "jane@example.test", contact_phone: "0712345678" },
    { display_name: 'Sam "The Vote"', external_reference: "R-2", contact_email: null, contact_phone: null },
  ]);
});

test("accepts the supplied Excel-style voter register headings and combines names", () => {
  const csv = [
    "Voter ID,National ID,First Name,Last Name,Gender,Date of Birth,Phone Number,Email,County,Constituency,Ward,Polling Station",
    "VOT-0001,29014567,James,Kamau,Male,1998-04-12,0712345001,james.kamau@example.com,Kakamega,Lurambi,Butali,Butali Primary School",
    "VOT-0002,30125678,Mary,Wanjiku,Female,2001-08-23,0723456002,mary.wanjiku@example.com,Kakamega,Navakholo,Ingotse,Ingotse Primary School",
  ].join("\r\n");

  const result = parseVoterRegisterCsv(csv);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.rows[0], {
    external_reference: "VOT-0001",
    display_name: "James Kamau",
    contact_email: "james.kamau@example.com",
    contact_phone: "0712345001",
  });
  assert.deepEqual(result.ignoredColumns, [
    "national_id", "gender", "date_of_birth", "county",
    "constituency", "ward", "polling_station",
  ]);

  const sanitized = serializeVoterRegisterCsv(result.rows);
  assert.match(sanitized, /^"name","external_reference","email","phone"/);
  assert.match(sanitized, /VOT-0001/);
  assert.doesNotMatch(sanitized, /29014567|Kakamega|1998-04-12|Male/);
});

test("accepts a full name or requires both first and last name", () => {
  assert.equal(parseVoterRegisterCsv("full_name,voter_id\nJane Doe,V-1").ok, true);
  assert.equal(parseVoterRegisterCsv("first_name,voter_id\nJane,V-1").ok, false);
  assert.equal(parseVoterRegisterCsv("name,first_name,last_name\nJane,Jane,Doe").ok, false);
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
  if (!result.ok) assert.match(result.error, /Duplicate voter reference/);
});

test("rejects duplicate semantic headers", () => {
  assert.equal(parseVoterRegisterCsv("name,full_name\nJane,Jane Doe").ok, false);
  assert.equal(parseVoterRegisterCsv("voter_id,reference,name\nV-1,V-2,Jane").ok, false);
});

test("rejects unsupported columns, empty files, oversized files and more than 500 rows", () => {
  assert.equal(parseVoterRegisterCsv("").ok, false);
  assert.equal(parseVoterRegisterCsv("name,ballot_choice\nJane,A").ok, false);
  assert.equal(parseVoterRegisterCsv("x".repeat(1_000_001)).ok, false);
  const csv = "name\n" + Array.from({ length: 501 }, (_, i) => "Voter " + i).join("\n");
  assert.equal(parseVoterRegisterCsv(csv).ok, false);
});
