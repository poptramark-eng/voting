import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ processId: string }> };

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505") return 409;
  if (code === "22023") return 400;
  return 500;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { processId } = await context.params;
  if (!isUuid(processId)) {
    return NextResponse.json({ error: "Invalid process identifier." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: appUser, error: userError } = await supabase
      .from("app_users").select("id").eq("auth_subject", session.user.sub).maybeSingle();
    if (userError || !appUser) {
      return NextResponse.json({ error: "Application identity not found." }, { status: userError ? 500 : 404 });
    }

    const { data: process, error: processError } = await supabase
      .from("voting_processes").select("event_id").eq("id", processId).maybeSingle();
    if (processError || !process) {
      return NextResponse.json({ error: "Voting process not found." }, { status: processError ? 500 : 404 });
    }

    const { data: event, error: eventError } = await supabase
      .from("voting_events").select("organization_id").eq("id", process.event_id).maybeSingle();
    if (eventError || !event) {
      return NextResponse.json({ error: "Voting event not found." }, { status: eventError ? 500 : 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships").select("role")
      .eq("organization_id", event.organization_id)
      .eq("user_id", appUser.id).eq("status", "ACTIVE").maybeSingle();
    if (membershipError || !membership) {
      return NextResponse.json({ error: "Organization membership not found." }, { status: membershipError ? 500 : 404 });
    }

    const canGovern = membership.role === "OWNER" || membership.role === "ADMIN";
    const { data: snapshots, error: snapshotError } = await supabase.rpc(
      "read_voter_register_snapshot_summaries",
      { target_process: processId },
    );

    if (snapshotError) {
      console.error("Voter register snapshot listing failed:", { code: snapshotError.code, message: snapshotError.message });
      return NextResponse.json({ error: "Unable to load voter register finalization history." }, { status: errorStatus(snapshotError.code) });
    }

    const snapshotIds = (snapshots ?? []).map((snapshot) => snapshot.id);
    let approvals: Array<{
      snapshot_id: string;
      approver_user_id: string;
      decision: string;
      comment: string | null;
      decided_at: string;
    }> = [];

    if (canGovern && snapshotIds.length > 0) {
      const { data, error } = await supabase
        .from("voter_register_snapshot_approvals")
        .select("snapshot_id,approver_user_id,decision,comment,decided_at")
        .in("snapshot_id", snapshotIds)
        .order("decided_at", { ascending: true });
      if (error) {
        console.error("Voter register snapshot approvals failed:", { code: error.code, message: error.message });
        return NextResponse.json({ error: "Unable to load finalization approvals." }, { status: 500 });
      }
      approvals = data ?? [];
    }

    return NextResponse.json({
      snapshots: (snapshots ?? []).map((snapshot) => ({
        ...snapshot,
        approvals: approvals.filter((approval) => approval.snapshot_id === snapshot.id),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Voter register snapshot listing failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to load voter register finalization history." }, { status: 500 });
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

  if (
    typeof body !== "object" || body === null || Array.isArray(body) ||
    typeof (body as Record<string, unknown>).reason !== "string" ||
    ((body as Record<string, unknown>).reason as string).trim().length < 10 ||
    ((body as Record<string, unknown>).reason as string).trim().length > 1000
  ) {
    return NextResponse.json({ error: "A finalization reason between 10 and 1000 characters is required." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("request_voter_register_finalization", {
      target_process: processId,
      target_reason: ((body as Record<string, unknown>).reason as string).trim(),
    });
    if (error) {
      console.error("Voter register finalization request failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    return NextResponse.json({ snapshotId: data, status: "PENDING_APPROVAL" }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Voter register finalization request failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to request voter register finalization." }, { status: 500 });
  }
}
