import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseVoterRegisterCsv } from "@/lib/voter-register-import";

type RouteContext = { params: Promise<{ processId: string }> };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { processId } = await context.params;
  if (!isUuid(processId)) {
    return NextResponse.json({ error: "Invalid process identifier." }, { status: 400 });
  }

  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "text/csv" && contentType !== "text/plain") {
    return NextResponse.json({ error: "Upload a CSV file using text/csv content type." }, { status: 415 });
  }

  const raw = await request.text();
  const parsed = parseVoterRegisterCsv(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const [{ data: appUser, error: userError }, { data: process, error: processError }] = await Promise.all([
      supabase.from("app_users").select("id").eq("auth_subject", session.user.sub).maybeSingle(),
      supabase.from("voting_processes").select("id, status").eq("id", processId).maybeSingle(),
    ]);

    if (userError || !appUser) {
      return NextResponse.json({ error: "Application identity is unavailable." }, { status: 403 });
    }
    if (processError || !process) {
      return NextResponse.json({ error: "Voting process not found." }, { status: 404 });
    }
    if (process.status !== "DRAFT") {
      return NextResponse.json({ error: "Voter imports are allowed only while the process is a draft." }, { status: 409 });
    }

    const rows = parsed.rows.map((row) => ({
      ...row,
      process_id: processId,
      created_by: appUser.id,
      eligibility_status: "PENDING" as const,
      source: "CSV_IMPORT" as const,
    }));

    const { error } = await supabase.from("voter_register_entries").insert(rows);
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
      console.error("Voter register CSV import rejected:", { code: error.code, message: error.message });
      return NextResponse.json({
        error: status === 403
          ? "You do not have permission to import voters into this process."
          : "The voter import could not be saved. Check the CSV and process permissions.",
      }, { status });
    }

    return NextResponse.json({
      imported: rows.length,
      pendingEligibilityReview: rows.length,
      message: "Voters imported as PENDING. Review eligibility before treating anyone as eligible.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Voter register import failed:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ error: "Unable to import the voter register." }, { status: 500 });
  }
}
