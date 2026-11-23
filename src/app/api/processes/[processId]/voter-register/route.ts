import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseVoterRegisterExportPagination, parseVoterRegisterPagination, splitLookaheadRows, toCsv } from "@/lib/voter-register-export";

type RouteContext = { params: Promise<{ processId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  return 500;
}

async function readRows(processId: string, mode: "VIEW" | "EXPORT", limit: number, offset: number) {
  const supabase = await createSupabaseServerClient();
  return supabase.rpc("read_voter_register_entries", {
    target_process: processId,
    target_access_mode: mode,
    target_limit: limit + 1,
    target_offset: offset,
  });
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { processId } = await context.params;
  if (!isUuid(processId)) {
    return NextResponse.json({ error: "Invalid process identifier." }, { status: 400 });
  }

  const url = new URL(request.url);
  const pagination = parseVoterRegisterPagination(url.searchParams.get("limit"), url.searchParams.get("offset"));
  if (!pagination) {
    return NextResponse.json({ error: "Invalid pagination. Limit must be 1–4999 and offset 0–1000000." }, { status: 400 });
  }

  try {
    const { data, error } = await readRows(processId, "VIEW", pagination.limit, pagination.offset);
    if (error) {
      console.error("Voter register read failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }
    const { rows, hasMore } = splitLookaheadRows(data, pagination.limit);
    return NextResponse.json(
      { rows, limit: pagination.limit, offset: pagination.offset, hasMore },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Voter register read failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to read the voter register." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { processId } = await context.params;
  if (!isUuid(processId)) {
    return NextResponse.json({ error: "Invalid process identifier." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "A JSON request object is required." }, { status: 400 });
  }

  const pagination = parseVoterRegisterExportPagination(body.limit, body.offset);
  if (!pagination) {
    return NextResponse.json({ error: "Invalid export pagination. Limit must be 1–4999 and offset 0–1000000." }, { status: 400 });
  }

  try {
    const { data, error } = await readRows(processId, "EXPORT", pagination.limit, pagination.offset);
    if (error) {
      console.error("Voter register export failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    const { rows, hasMore } = splitLookaheadRows(data, pagination.limit);
    const csv = toCsv(rows);
    return new NextResponse(csv, {
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
    return NextResponse.json({ error: "Unable to export the voter register." }, { status: 500 });
  }
}
