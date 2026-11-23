import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

type RouteContext = { params: Promise<{ organizationId: string }> };
type VotingCategory = Database["public"]["Enums"]["voting_category"];
type AssuranceTier = Database["public"]["Enums"]["assurance_tier"];

const categories: VotingCategory[] = [
  "GENERAL_POLL",
  "CONTEST",
  "ORGANIZATIONAL_ELECTION",
  "PUBLIC_ELECTION",
];
const tiers: AssuranceTier[] = ["STANDARD", "ENHANCED", "HIGH", "CRITICAL"];

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { organizationId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
    return NextResponse.json({ error: "Invalid organization identifier." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const category = body.category;
  const assuranceTier = body.assuranceTier ?? "STANDARD";
  const description = typeof body.description === "string" ? body.description.trim() : null;

  if (
    title.length < 2 ||
    title.length > 200 ||
    typeof category !== "string" ||
    !categories.includes(category as VotingCategory) ||
    typeof assuranceTier !== "string" ||
    !tiers.includes(assuranceTier as AssuranceTier) ||
    (description !== null && description.length > 4000)
  ) {
    return NextResponse.json({ error: "Provide a valid title, category, assurance tier and description." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: user, error: userError } = await supabase
      .from("app_users")
      .select("id")
      .eq("auth_subject", session.user.sub)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json({ error: "Application identity could not be resolved." }, { status: 403 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (
      membershipError ||
      !membership ||
      !["OWNER", "ADMIN", "ELECTION_MANAGER"].includes(membership.role)
    ) {
      return NextResponse.json({ error: "You do not have permission to create events in this organization." }, { status: 403 });
    }

    const { data: event, error } = await supabase
      .from("voting_events")
      .insert({
        organization_id: organizationId,
        title,
        category: category as VotingCategory,
        assurance_tier: assuranceTier as AssuranceTier,
        description,
        created_by: user.id,
      })
      .select("id, title, category, assurance_tier, status, created_at")
      .single();

    if (error || !event) {
      console.error("Voting event creation failed:", { code: error?.code, message: error?.message });
      return NextResponse.json({ error: "Unable to create the voting event." }, { status: 400 });
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Voting event creation failed:", code);
    return NextResponse.json({ error: "Unable to create the voting event." }, { status: 500 });
  }
}
