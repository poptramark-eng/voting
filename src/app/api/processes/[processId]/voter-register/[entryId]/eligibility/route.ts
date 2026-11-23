import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ processId: string; entryId: string }> };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { processId, entryId } = await context.params;
  if (!isUuid(processId) || !isUuid(entryId)) {
    return NextResponse.json({ error: "Invalid process or voter entry identifier." }, { status: 400 });
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

  const status = body.status;
  const reason = body.reason;
  if (
    (status !== "ELIGIBLE" && status !== "REJECTED" && status !== "REVOKED") ||
    typeof reason !== "string" ||
    reason.trim().length < 10 ||
    reason.trim().length > 1000
  ) {
    return NextResponse.json({
      error: "Choose ELIGIBLE, REJECTED or REVOKED and provide a review reason between 10 and 1000 characters.",
    }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("update_voter_register_eligibility", {
      target_process: processId,
      target_entry: entryId,
      target_status: status,
      target_reason: reason.trim(),
    });

    if (error) {
      const responseStatus =
        error.code === "42501" ? 403 :
        error.code === "P0002" ? 404 :
        error.code === "22023" ? 409 : 500;
      console.error("Voter eligibility review failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: responseStatus });
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Voter eligibility review failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to record the eligibility decision." }, { status: 500 });
  }
}
