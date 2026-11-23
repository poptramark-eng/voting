import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ requestId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505" || code === "22023") return 409;
  return 500;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { requestId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: "Invalid voter PII request identifier." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) throw new Error("Invalid body");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  if (
    (body.decision !== "APPROVE" && body.decision !== "REJECT") ||
    (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > 2000))
  ) {
    return NextResponse.json({ error: "Provide APPROVE or REJECT and an optional comment." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("decide_voter_pii_access_request", {
      target_request: requestId,
      target_decision: body.decision,
      target_comment: typeof body.comment === "string" ? body.comment.trim() || undefined : undefined,
    });

    if (error) {
      console.error("Voter PII decision failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Voter PII decision failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to record the approval decision." }, { status: 500 });
  }
}
