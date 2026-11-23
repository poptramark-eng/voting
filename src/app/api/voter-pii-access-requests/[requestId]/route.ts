import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ requestId: string }> };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { requestId } = await context.params;
  if (!isUuid(requestId)) {
    return NextResponse.json({ error: "Invalid voter PII request identifier." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const [requestResult, approvalResult] = await Promise.all([
      supabase
        .from("voter_pii_access_requests")
        .select("id,organization_id,event_id,process_id,scope_type,recipient_user_id,requested_by,permitted_categories,purpose,assurance_tier,required_approvals,requested_expires_at,status,granted_at,expires_at,resolved_at,revoked_by,revoked_at,revocation_reason,created_at,updated_at")
        .eq("id", requestId)
        .maybeSingle(),
      supabase
        .from("voter_pii_access_approvals")
        .select("id,request_id,approver_user_id,decision,comment,request_snapshot,decided_at")
        .eq("request_id", requestId)
        .order("decided_at", { ascending: true }),
    ]);

    if (requestResult.error || approvalResult.error) {
      console.error("Voter PII request detail failed:", {
        requestCode: requestResult.error?.code,
        approvalCode: approvalResult.error?.code,
      });
      return NextResponse.json({ error: "Unable to load the access request." }, { status: 500 });
    }

    if (!requestResult.data) {
      return NextResponse.json({ error: "Access request not found." }, { status: 404 });
    }

    const item = requestResult.data;
    const effectiveStatus =
      item.status === "ACTIVE" && item.expires_at && new Date(item.expires_at).getTime() <= Date.now()
        ? "EXPIRED"
        : item.status;

    return NextResponse.json(
      { request: { ...item, effectiveStatus }, approvals: approvalResult.data ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Voter PII request detail failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to load the access request." }, { status: 500 });
  }
}
