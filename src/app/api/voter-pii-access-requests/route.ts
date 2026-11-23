import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const categories = [
  "VOTER_NAME",
  "CONTACT_EMAIL",
  "CONTACT_PHONE",
  "EXTERNAL_REFERENCE",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505") return 409;
  if (code === "22023") return 400;
  return 500;
}

export async function GET(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const processId = url.searchParams.get("processId");
  if ((!eventId && !processId) || (eventId && !isUuid(eventId)) || (processId && !isUuid(processId))) {
    return NextResponse.json({ error: "Provide a valid eventId or processId." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from("voter_pii_access_requests")
      .select("id,organization_id,event_id,process_id,scope_type,recipient_user_id,requested_by,permitted_categories,purpose,assurance_tier,required_approvals,requested_expires_at,status,granted_at,expires_at,resolved_at,revoked_by,revoked_at,revocation_reason,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (eventId) query = query.eq("event_id", eventId);
    if (processId) query = query.eq("process_id", processId);

    const { data, error } = await query;
    if (error) {
      console.error("Voter PII request listing failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: "Unable to load access requests." }, { status: 500 });
    }

    const now = Date.now();
    const requests = (data ?? []).map((item) => ({
      ...item,
      effectiveStatus:
        ((item.status === "ACTIVE" && item.expires_at && new Date(item.expires_at).getTime() <= now) ||
        (item.status === "PENDING" && new Date(item.requested_expires_at).getTime() <= now))
          ? "EXPIRED"
          : item.status,
    }));

    return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Voter PII request listing failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to load access requests." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) throw new Error("Invalid body");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  const scope = body.scope;
  const eventId = body.eventId;
  const processId = body.processId ?? null;
  const recipientUserId = body.recipientUserId;
  const requestedCategories = body.categories;
  const purpose = body.purpose;
  const expiresAt = body.expiresAt;

  if (
    (scope !== "EVENT" && scope !== "PROCESS") ||
    !isUuid(eventId) ||
    (scope === "EVENT" && processId !== null) ||
    (scope === "PROCESS" && !isUuid(processId)) ||
    !isUuid(recipientUserId) ||
    !Array.isArray(requestedCategories) ||
    requestedCategories.length < 1 ||
    requestedCategories.length > 4 ||
    requestedCategories.some((value) => typeof value !== "string" || !categories.includes(value as (typeof categories)[number])) ||
    new Set(requestedCategories).size !== requestedCategories.length ||
    typeof purpose !== "string" ||
    purpose.trim().length < 20 ||
    purpose.trim().length > 1000 ||
    typeof expiresAt !== "string" ||
    Number.isNaN(new Date(expiresAt).getTime()) ||
    new Date(expiresAt).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "Invalid scope, recipient, data categories, purpose or expiry." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("request_voter_pii_access", {
      target_scope: scope,
      target_event: eventId,
      target_process: typeof processId === "string" ? processId : null,
      target_recipient: recipientUserId,
      target_categories: requestedCategories,
      target_purpose: purpose.trim(),
      target_expires_at: new Date(expiresAt).toISOString(),
    });

    if (error) {
      console.error("Voter PII access request failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
    }

    return NextResponse.json({ requestId: data, status: "PENDING" }, { status: 201 });
  } catch (error) {
    console.error("Voter PII access request failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to create the access request." }, { status: 500 });
  }
}
