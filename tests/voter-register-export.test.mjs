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
    ["line1\r\nline2", '"line1\r\nline2"'],
    [null, '""'],
    ["normal", '"normal"'],
  ];
  for (const [input, expected] of cases) assert.equal(csvCell(input), expected);
});

test("CSV export uses the union of columns and preserves CRLF separators", () => {
  assert.equal(
    toCsv([{ name: "A", email: "a@example.test" }, { name: "B", phone: "123" }]),
    '"name","email","phone"\r\n"A","a@example.test",""\r\n"B","","123"',
  );
  assert.equal(toCsv([]), "");
});

import { createVoterRegisterRouteHandlers } from "../src/lib/voter-register-route.ts";

const validProcessId = "00000000-0000-4000-8000-000000000000";
const routeContext = { params: Promise.resolve({ processId: validProcessId }) };

test("route GET requires authentication before querying the register", async () => {
  let calls = 0;
  const handlers = createVoterRegisterRouteHandlers({
    getSession: async () => null,
    readRows: async () => { calls += 1; return { data: [], error: null }; },
  });
  const response = await handlers.GET(new Request("https://example.test/register"), routeContext);
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("route GET rejects malformed process IDs without calling the database", async () => {
  let calls = 0;
  const handlers = createVoterRegisterRouteHandlers({
    getSession: async () => ({ user: { sub: "auth0|test" } }),
    readRows: async () => { calls += 1; return { data: [], error: null }; },
  });
  const response = await handlers.GET(
    new Request("https://example.test/register"),
    { params: Promise.resolve({ processId: "not-a-uuid" }) },
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("route GET requests one look-ahead row and reports exact final-page state", async () => {
  let call;
  const handlers = createVoterRegisterRouteHandlers({
    getSession: async () => ({ user: { sub: "auth0|test" } }),
    readRows: async (...args) => {
      call = args;
      return { data: [{ id: 1 }, { id: 2 }], error: null };
    },
  });
  const response = await handlers.GET(
    new Request("https://example.test/register?limit=2&offset=0"),
    routeContext,
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(call, [validProcessId, "VIEW", 3, 0]);
  assert.deepEqual(payload, {
    rows: [{ id: 1 }, { id: 2 }],
    limit: 2,
    offset: 0,
    hasMore: false,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("route POST exports only the requested rows and sets X-Has-More from look-ahead", async () => {
  let call;
  const handlers = createVoterRegisterRouteHandlers({
    getSession: async () => ({ user: { sub: "auth0|test" } }),
    readRows: async (...args) => {
      call = args;
      return {
        data: [{ displayName: "=1+1" }, { displayName: "Normal" }],
        error: null,
      };
    },
  });
  const response = await handlers.POST(
    new Request("https://example.test/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1, offset: 0 }),
    }),
    routeContext,
  );
  const csv = await response.text();
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(call, [validProcessId, "EXPORT", 2, 0]);
  assert.equal(csv, '"displayName"\r\n"\'=1+1"');
  assert.equal(response.headers.get("x-has-more"), "true");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("route POST rejects invalid export pagination", async () => {
  let calls = 0;
  const handlers = createVoterRegisterRouteHandlers({
    getSession: async () => ({ user: { sub: "auth0|test" } }),
    readRows: async () => { calls += 1; return { data: [], error: null }; },
  });
  const response = await handlers.POST(
    new Request("https://example.test/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5000 }),
    }),
    routeContext,
  );
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
