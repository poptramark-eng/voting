import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ processId: string; snapshotId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505" || code === "22023") return 409;
  return 500;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { processId, snapshotId } = await context.params;
  if (!UUID.test(processId) || !UUID.test(snapshotId)) {
    return NextResponse.json({ error: "Invalid process or snapshot identifier." }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "A JSON request object is required." }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  if (
    (payload.decision !== "APPROVE" && payload.decision !== "REJECT") ||
    (payload.comment !== undefined && (typeof payload.comment !== "string" || payload.comment.length > 1000))
  ) {
    return NextResponse.json({ error: "Provide APPROVE or REJECT and an optional comment up to 1000 characters." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: snapshot, error: snapshotError } = await supabase
      .from("voter_register_snapshots").select("id")
      .eq("id", snapshotId).eq("process_id", processId).maybeSingle();
    if (snapshotError || !snapshot) {
      return NextResponse.json({ error: "Voter register snapshot not found." }, { status: snapshotError ? 500 : 404 });
    }

    const { data, error } = await supabase.rpc("decide_voter_register_finalization", {
      target_snapshot: snapshotId,
      target_decision: payload.decision,
      target_comment: typeof payload.comment === "string" ? payload.comment.trim() || undefined : undefined,
    });
    if (error) {
      console.error("Voter register finalization decision failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }
    return NextResponse.json({ snapshotId: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Voter register finalization decision failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to record the finalization decision." }, { status: 500 });
  }
}
