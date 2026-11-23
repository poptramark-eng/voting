import {
  parseVoterRegisterExportPagination,
  parseVoterRegisterPagination,
  splitLookaheadRows,
  toCsv,
} from "./voter-register-export.ts";

type RouteContext = { params: Promise<{ processId: string }> };
type Session = { user?: { sub?: string } } | null;
type ReadResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

type Dependencies = {
  getSession: () => Promise<Session>;
  readRows: (
    processId: string,
    mode: "VIEW" | "EXPORT",
    limit: number,
    offset: number,
  ) => Promise<ReadResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  return 500;
}

export function createVoterRegisterRouteHandlers(dependencies: Dependencies) {
  async function authenticate() {
    const session = await dependencies.getSession();
    return session?.user?.sub ? null : Response.json({ error: "Authentication required." }, { status: 401 });
  }

  async function GET(request: Request, context: RouteContext): Promise<Response> {
    const authError = await authenticate();
    if (authError) return authError;

    const { processId } = await context.params;
    if (!isUuid(processId)) {
      return Response.json({ error: "Invalid process identifier." }, { status: 400 });
    }

    const url = new URL(request.url);
    const pagination = parseVoterRegisterPagination(
      url.searchParams.get("limit"),
      url.searchParams.get("offset"),
    );
    if (!pagination) {
      return Response.json(
        { error: "Invalid pagination. Limit must be 1–4999 and offset 0–1000000." },
        { status: 400 },
      );
    }

    try {
      const { data, error } = await dependencies.readRows(
        processId,
        "VIEW",
        pagination.limit + 1,
        pagination.offset,
      );
      if (error) {
        console.error("Voter register read failed:", { code: error.code, message: error.message });
        return Response.json({ error: error.message }, { status: errorStatus(error.code) });
      }

      const { rows, hasMore } = splitLookaheadRows(data, pagination.limit);
      return Response.json(
        { rows, limit: pagination.limit, offset: pagination.offset, hasMore },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      console.error("Voter register read failed:", error instanceof Error ? error.message : "UNKNOWN");
      return Response.json({ error: "Unable to read the voter register." }, { status: 500 });
    }
  }

  async function POST(request: Request, context: RouteContext): Promise<Response> {
    const authError = await authenticate();
    if (authError) return authError;

    const { processId } = await context.params;
    if (!isUuid(processId)) {
      return Response.json({ error: "Invalid process identifier." }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "A JSON request body is required." }, { status: 400 });
    }

    if (!isRecord(body)) {
      return Response.json({ error: "A JSON request object is required." }, { status: 400 });
    }

    const pagination = parseVoterRegisterExportPagination(body.limit, body.offset);
    if (!pagination) {
      return Response.json(
        { error: "Invalid export pagination. Limit must be 1–4999 and offset 0–1000000." },
        { status: 400 },
      );
    }

    try {
      const { data, error } = await dependencies.readRows(
        processId,
        "EXPORT",
        pagination.limit + 1,
        pagination.offset,
      );
      if (error) {
        console.error("Voter register export failed:", { code: error.code, message: error.message });
        return Response.json({ error: error.message }, { status: errorStatus(error.code) });
      }

      const { rows, hasMore } = splitLookaheadRows(data, pagination.limit);
      return new Response(toCsv(rows), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="voter-register-${processId}.csv"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Has-More": String(hasMore),
        },
      });
    } catch (error) {
      console.error("Voter register export failed:", error instanceof Error ? error.message : "UNKNOWN");
      return Response.json({ error: "Unable to export the voter register." }, { status: 500 });
    }
  }

  return { GET, POST };
}
