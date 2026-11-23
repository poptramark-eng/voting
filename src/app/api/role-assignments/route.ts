import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type ScopedRole = Extract<
  Database["public"]["Enums"]["organization_member_role"],
  "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER"
>;

const scopedRoles: ScopedRole[] = ["ELECTION_MANAGER", "AUDITOR", "OBSERVER"];

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  }

  const action = body.action;
  const scope = body.scope;
  const targetId = body.targetId;
  const userId = body.userId;

  if (
    (action !== "assign" && action !== "revoke") ||
    (scope !== "EVENT" && scope !== "PROCESS") ||
    !isUuid(targetId) ||
    !isUuid(userId)
  ) {
    return NextResponse.json({ error: "Provide a valid action, scope, target and user." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  if (action === "revoke") {
    const result =
      scope === "EVENT"
        ? await supabase.rpc("revoke_event_role", { target_event: targetId, target_user: userId })
        : await supabase.rpc("revoke_process_role", { target_process: targetId, target_user: userId });

    if (result.error) {
      const status =
        result.error.code === "42501" ? 403 :
        result.error.code === "P0002" ? 404 :
        result.error.code === "22023" ? 400 : 500;
      console.error("Scoped-role revocation failed:", { code: result.error.code, message: result.error.message });
      return NextResponse.json({ error: result.error.message }, { status });
    }

    return NextResponse.json({ revoked: true });
  }

  const role = body.role;
  const expiresAt = body.expiresAt;
  if (
    typeof role !== "string" ||
    !scopedRoles.includes(role as ScopedRole) ||
    (expiresAt !== undefined &&
      expiresAt !== null &&
      (typeof expiresAt !== "string" ||
        Number.isNaN(new Date(expiresAt).getTime()) ||
        new Date(expiresAt).getTime() <= Date.now()))
  ) {
    return NextResponse.json({ error: "Provide a valid scoped role and optional future expiry." }, { status: 400 });
  }

  const result =
    scope === "EVENT"
      ? await supabase.rpc("assign_event_role", {
          target_event: targetId,
          target_user: userId,
          target_role: role as ScopedRole,
          target_expires_at: typeof expiresAt === "string" ? new Date(expiresAt).toISOString() : undefined,
        })
      : await supabase.rpc("assign_process_role", {
          target_process: targetId,
          target_user: userId,
          target_role: role as ScopedRole,
          target_expires_at: typeof expiresAt === "string" ? new Date(expiresAt).toISOString() : null,
        });

  if (result.error) {
    const status =
      result.error.code === "42501" ? 403 :
      result.error.code === "P0002" ? 404 :
      result.error.code === "22023" ? 400 :
      result.error.code === "23505" ? 409 : 500;
    console.error("Scoped-role assignment failed:", { code: result.error.code, message: result.error.message });
    return NextResponse.json({ error: result.error.message }, { status });
  }

  return NextResponse.json({ assignmentId: result.data }, { status: 201 });
}
