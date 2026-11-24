import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database.types";

type RouteContext = { params: Promise<{ eventId: string }> };
type BallotFormat = Database["public"]["Enums"]["ballot_format"];
type AssuranceTier = Database["public"]["Enums"]["assurance_tier"];

const ballotFormats: BallotFormat[] = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "RANKED_CHOICE",
  "YES_NO",
  "APPROVAL",
  "SCORED",
];
const tiers: AssuranceTier[] = ["STANDARD", "ENHANCED", "HIGH", "CRITICAL"];
const eligibilityModes = [
  "OPEN_LINK",
  "INVITATION_ONLY",
  "MANAGED_REGISTER",
  "VERIFIED_MEMBERSHIP",
  "COMBINED",
] as const;

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { eventId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ error: "Invalid event identifier." }, { status: 400 });
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
  const ballotFormat = body.ballotFormat;
  const eligibilityMode = body.eligibilityMode;
  const assuranceTier = body.assuranceTier ?? "STANDARD";
  const opensAt = typeof body.opensAt === "string" ? new Date(body.opensAt) : null;
  const closesAt = typeof body.closesAt === "string" ? new Date(body.closesAt) : null;

  if (
    title.length < 2 ||
    title.length > 200 ||
    typeof ballotFormat !== "string" ||
    !ballotFormats.includes(ballotFormat as BallotFormat) ||
    typeof eligibilityMode !== "string" ||
    !eligibilityModes.includes(eligibilityMode as (typeof eligibilityModes)[number]) ||
    typeof assuranceTier !== "string" ||
    !tiers.includes(assuranceTier as AssuranceTier) ||
    !opensAt ||
    !closesAt ||
    Number.isNaN(opensAt.getTime()) ||
    Number.isNaN(closesAt.getTime()) ||
    opensAt.getTime() <= Date.now() ||
    closesAt.getTime() <= opensAt.getTime()
  ) {
    return NextResponse.json({ error: "Provide a valid title, ballot format, eligibility mode and future schedule." }, { status: 400 });
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

    const { data: event, error: eventError } = await supabase
      .from("voting_events")
      .select("id, organization_id, assurance_tier")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      return NextResponse.json({ error: "Voting event not found." }, { status: 404 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", event.organization_id)
      .eq("user_id", user.id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (membershipError || !membership) {
      return NextResponse.json({ error: "An active organization membership is required." }, { status: 403 });
    }

    // Generate the identifier before insertion so the INSERT does not need
    // PostgreSQL RETURNING. The separate SELECT is still governed by read RLS.
    const processId = crypto.randomUUID();
    const { error: insertError } = await supabase
      .from("voting_processes")
      .insert({
        id: processId,
        event_id: eventId,
        title,
        ballot_format: ballotFormat as BallotFormat,
        eligibility_mode: eligibilityMode,
        assurance_tier: assuranceTier as AssuranceTier,
        opens_at: opensAt.toISOString(),
        closes_at: closesAt.toISOString(),
        vote_change_policy: { kind: "DISABLED" } as Json,
        results_disclosure: { kind: "AFTER_CLOSURE" } as Json,
        created_by: user.id,
      });

    if (insertError) {
      console.error("Voting process creation failed:", {
        code: insertError.code,
        message: insertError.message,
      });
      return NextResponse.json({ error: "Unable to create the voting process." }, { status: 400 });
    }

    const { data: process, error: readError } = await supabase
      .from("voting_processes")
      .select("id, title, status, assurance_tier, opens_at, closes_at")
      .eq("id", processId)
      .single();

    if (readError || !process) {
      console.error("Voting process was inserted but could not be read:", {
        code: readError?.code,
        message: readError?.message,
        processId,
      });
      return NextResponse.json({ error: "The voting process was created but could not be loaded. Refresh the page." }, { status: 500 });
    }

    return NextResponse.json({ process }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Voting process creation failed:", code);
    return NextResponse.json({ error: "Unable to create the voting process." }, { status: 500 });
  }
}
