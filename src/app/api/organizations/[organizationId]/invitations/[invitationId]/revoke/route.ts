import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ organizationId: string; invitationId: string }> };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(_request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { organizationId, invitationId } = await context.params;
  if (!isUuid(organizationId) || !isUuid(invitationId)) {
    return NextResponse.json({ error: "Invalid organization or invitation identifier." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: invitations, error: lookupError } = await supabase.rpc(
      "list_organization_invitations",
      { target_org: organizationId },
    );

    if (lookupError || !(invitations ?? []).some((invitation) => invitation.id === invitationId)) {
      return NextResponse.json({ error: "Organization invitation not found." }, { status: lookupError ? 500 : 404 });
    }

    const { error } = await supabase.rpc("revoke_organization_invitation", {
      target_invitation: invitationId,
    });

    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Organization invitation revocation failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to revoke the invitation." }, { status: 500 });
  }
}
