import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ requestId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { requestId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json({ error: "Invalid workflow request identifier." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) throw new Error("Invalid body");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  const decision = body.decision;
  const comment = body.comment;
  if (
    (decision !== "APPROVE" && decision !== "REJECT") ||
    (comment !== undefined && (typeof comment !== "string" || comment.length > 2000))
  ) {
    return NextResponse.json({ error: "Provide a valid decision and optional comment." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("approve_process_workflow_request", {
      target_request: requestId,
      decision,
      comment: typeof comment === "string" ? comment.trim() || null : null,
    });

    if (error) {
      const status =
        error.code === "42501" ? 403 :
        error.code === "P0002" ? 404 :
        error.code === "22023" || error.code === "23505" ? 409 : 500;
      console.error("Workflow decision failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ requestId: data, decision });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Workflow decision failed:", code);
    return NextResponse.json({ error: "Unable to record this decision." }, { status: 500 });
  }
}
