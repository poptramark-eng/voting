import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  const token = isRecord(body) ? body.token : null;
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/i.test(token)) {
    return NextResponse.json({ error: "Invalid invitation token." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_organization_invitation", {
      target_token: token,
    });

    if (error) {
      const status = error.code === "42501" ? 403 :
        error.code === "23505" ? 409 :
        error.code === "22023" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Organization invitation acceptance failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to accept the organization invitation." }, { status: 500 });
  }
}
