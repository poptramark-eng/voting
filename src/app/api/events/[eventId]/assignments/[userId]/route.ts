import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ eventId: string; userId: string }> };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { eventId, userId } = await context.params;
  if (!isUuid(eventId) || !isUuid(userId)) {
    return NextResponse.json({ error: "Invalid event or user identifier." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("revoke_event_role", {
      target_event: eventId,
      target_user: userId,
    });

    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ revoked: Boolean(data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Event role revocation failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to revoke the event role." }, { status: 500 });
  }
}
