import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { requestId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: "Invalid voter PII request identifier." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).reason !== "string" ||
    ((body as Record<string, unknown>).reason as string).trim().length < 10 ||
    ((body as Record<string, unknown>).reason as string).trim().length > 1000
  ) {
    return NextResponse.json({ error: "Provide a revocation reason between 10 and 1000 characters." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("revoke_voter_pii_access", {
      target_request: requestId,
      target_reason: ((body as Record<string, unknown>).reason as string).trim(),
    });

    if (error) {
      const status =
        error.code === "42501" ? 403 :
        error.code === "P0002" ? 404 :
        error.code === "22023" ? 409 : 500;
      console.error("Voter PII revocation failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ requestId, revoked: data === true });
  } catch (error) {
    console.error("Voter PII revocation failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to revoke voter PII access." }, { status: 500 });
  }
}
