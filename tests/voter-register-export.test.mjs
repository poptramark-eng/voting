import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_VOTER_REGISTER_PAGE_SIZE,
  parseVoterRegisterExportPagination,
  parseVoterRegisterPagination,
  splitLookaheadRows,
  csvCell,
  toCsv,
} from "../src/lib/voter-register-export.ts";

test("look-ahead pagination distinguishes a full final page from another page", () => {
  assert.deepEqual(splitLookaheadRows([{ id: 1 }, { id: 2 }], 2), {
    rows: [{ id: 1 }, { id: 2 }], hasMore: false,
  });
  assert.deepEqual(splitLookaheadRows([{ id: 1 }, { id: 2 }, { id: 3 }], 2), {
    rows: [{ id: 1 }, { id: 2 }], hasMore: true,
  });
  assert.deepEqual(splitLookaheadRows([{ id: 1 }], 2), {
    rows: [{ id: 1 }], hasMore: false,
  });
});

test("page size leaves room for one look-ahead row within the RPC maximum", () => {
  assert.deepEqual(parseVoterRegisterPagination(null, null), { limit: 500, offset: 0 });
  assert.deepEqual(parseVoterRegisterPagination("4999", "100"), { limit: 4999, offset: 100 });
  assert.equal(parseVoterRegisterPagination("5000", "0"), null);
  assert.equal(parseVoterRegisterPagination("1.5", "0"), null);
  assert.equal(parseVoterRegisterPagination("1", "-1"), null);
  assert.equal(MAX_VOTER_REGISTER_PAGE_SIZE, 4999);
});

test("CSV export pagination validates numeric JSON inputs", () => {
  assert.deepEqual(parseVoterRegisterExportPagination(undefined, undefined), {
    limit: 4999, offset: 0,
  });
  assert.deepEqual(parseVoterRegisterExportPagination(20, 40), { limit: 20, offset: 40 });
  assert.equal(parseVoterRegisterExportPagination("20", 0), null);
  assert.equal(parseVoterRegisterExportPagination(5000, 0), null);
  assert.equal(parseVoterRegisterExportPagination(20, -1), null);
});

test("CSV cells neutralize formula-leading values and escape CSV syntax", () => {
  const cases = [
    ["=1+1", "\"'=1+1\""],
    ["  +SUM(A1:A2)", "\"'  +SUM(A1:A2)\""],
    ["@cmd", "\"'@cmd\""],
    ["-1+2", "\"'-1+2\""],
    ["safe, value", "\"safe, value\""],
    ['say "hello"', '"say ""hello"""'],
    ["line1\\r\\nline2", '"line1\\r\\nline2"'],
    [null, '""'],
    ["normal", '"normal"'],
  ];
  for (const [input, expected] of cases) assert.equal(csvCell(input), expected);
});

test("CSV export uses the union of columns and preserves CRLF separators", () => {
  assert.equal(
    toCsv([{ name: "A", email: "a@example.test" }, { name: "B", phone: "123" }]),
    '"name","email","phone"\\r\\n"A","a@example.test",""\\r\\n"B","","123"',
  );
  assert.equal(toCsv([]), "");
});
