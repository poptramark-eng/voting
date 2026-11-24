import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type RouteContext = { params: Promise<{ organizationId: string }> };
type MemberRole = Database["public"]["Enums"]["organization_member_role"];
type MemberStatus = Database["public"]["Enums"]["organization_member_status"];

const invitationRoles: MemberRole[] = ["ADMIN", "BILLING_MANAGER", "MEMBER"];
const membershipRoles: MemberRole[] = ["OWNER", "ADMIN", "BILLING_MANAGER", "MEMBER"];
const manageableStatuses: MemberStatus[] = ["ACTIVE", "SUSPENDED", "REMOVED"];

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
  if (code === "23514") return 409;
  if (code === "22023") return 400;
  return 500;
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { organizationId } = await context.params;
  if (!isUuid(organizationId)) {
    return NextResponse.json({ error: "Invalid organization identifier." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const [{ data: members, error: memberError }, { data: invitations, error: invitationError }] = await Promise.all([
      supabase.rpc("list_organization_members", { target_org: organizationId }),
      supabase.rpc("list_organization_invitations", { target_org: organizationId }),
    ]);

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: errorStatus(memberError.code) });
    }
    if (invitationError) {
      return NextResponse.json({ error: "Unable to load organization invitations." }, { status: 500 });
    }

    const normalizedInvitations = invitations ?? [];

    return NextResponse.json(
      { members: members ?? [], invitations: normalizedInvitations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Organization member directory failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to load organization members." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { organizationId } = await context.params;
  if (!isUuid(organizationId)) {
    return NextResponse.json({ error: "Invalid organization identifier." }, { status: 400 });
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

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role;
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof role !== "string" ||
    !invitationRoles.includes(role as MemberRole)
  ) {
    return NextResponse.json({ error: "Provide a valid email address and assignable role." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_organization_invitation", {
      target_org: organizationId,
      target_email: email,
      target_role: role as MemberRole,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    // Trigger prompt delivery after the invitation and outbox row have committed.
    // The scheduled worker remains the recovery path if this best-effort request fails.
    const appBaseUrl = process.env.APP_BASE_URL;
    const cronSecret = process.env.CRON_SECRET;
    if (appBaseUrl && cronSecret) {
      try {
        const workerUrl = new URL("/api/internal/notifications/process-invitations", appBaseUrl);
        const workerResponse = await fetch(workerUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${cronSecret}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!workerResponse.ok) {
          console.warn("Invitation email worker did not complete immediately:", workerResponse.status);
        }
      } catch (deliveryError) {
        console.warn(
          "Invitation email remains queued for scheduled retry:",
          deliveryError instanceof Error ? deliveryError.message : "UNKNOWN",
        );
      }
    }

    return NextResponse.json(
      { invitation: data, delivery: "QUEUED" },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Organization invitation creation failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to create the organization invitation." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { organizationId } = await context.params;
  if (!isUuid(organizationId)) {
    return NextResponse.json({ error: "Invalid organization identifier." }, { status: 400 });
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
  const status = body.status;
  if (
    typeof role !== "string" ||
    !membershipRoles.includes(role as MemberRole) ||
    typeof status !== "string" ||
    !manageableStatuses.includes(status as MemberStatus)
  ) {
    return NextResponse.json({ error: "Provide a valid organization role and membership status." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("update_organization_membership", {
      target_org: organizationId,
      target_user: String(body.userId),
      target_role: role as MemberRole,
      target_status: status as MemberStatus,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Organization membership update failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to update organization membership." }, { status: 500 });
  }
}
