import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type RouteContext = { params: Promise<{ processId: string }> };
type ScopedRole = Extract<Database["public"]["Enums"]["organization_member_role"], "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER">;

const roles: ScopedRole[] = ["ELECTION_MANAGER", "AUDITOR", "OBSERVER"];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

    const [{ data: members, error: memberError }, { data: eventAssignments, error: eventAssignmentError }, { data: processAssignments, error: processAssignmentError }] = await Promise.all([
      supabase.rpc("list_organization_members", { target_org: event.organization_id }),
      supabase.from("event_role_assignments")
        .select("id,user_id,role,status,expires_at,created_at")
        .eq("event_id", process.event_id)
        .order("created_at", { ascending: false }),
      supabase.from("process_role_assignments")
        .select("id,user_id,role,status,expires_at,created_at")
        .eq("process_id", processId)
        .order("created_at", { ascending: false }),
    ]);

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: errorStatus(memberError.code) });
    }
    if (eventAssignmentError || processAssignmentError) {
      return NextResponse.json({ error: "Unable to load scoped role assignments." }, { status: 500 });
    }

    return NextResponse.json({
      members: (members ?? []).filter((member) => member.status === "ACTIVE"),
      eventAssignments: eventAssignments ?? [],
      processAssignments: processAssignments ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Process role assignment listing failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to load process role assignments." }, { status: 500 });
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
  if (!isRecord(body) || !isUuid(String(body.userId ?? ""))) {
    return NextResponse.json({ error: "A valid userId is required." }, { status: 400 });
  }

  const role = body.role;
  const expiresAt = body.expiresAt;
  if (
    typeof role !== "string" ||
    !roles.includes(role as ScopedRole) ||
    (expiresAt !== undefined && expiresAt !== null &&
      (typeof expiresAt !== "string" || Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= Date.now()))
  ) {
    return NextResponse.json({ error: "Provide an allowed scoped role and an optional future expiry." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("assign_process_role", {
      target_process: processId,
      target_user: String(body.userId),
      target_role: role as ScopedRole,
      target_expires_at: typeof expiresAt === "string" ? new Date(expiresAt).toISOString() : null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    return NextResponse.json({ assignmentId: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Process role assignment failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to assign the process role." }, { status: 500 });
  }
}
