import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ processId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { processId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(processId)) {
    return NextResponse.json({ error: "Invalid process identifier." }, { status: 400 });
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
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const displayOrder = body.displayOrder ?? 0;

  if (
    title.length < 1 ||
    title.length > 200 ||
    (description !== null && description.length > 4000) ||
    typeof displayOrder !== "number" ||
    !Number.isInteger(displayOrder) ||
    displayOrder < 0
  ) {
    return NextResponse.json({ error: "Provide a valid contest title, description and display order." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const contestId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("contests").insert({
      id: contestId,
      process_id: processId,
      title,
      description,
      display_order: displayOrder,
    });

    if (insertError) {
      const status = insertError.code === "42501" ? 403 : insertError.code === "23503" ? 404 : 400;
      console.error("Contest creation failed:", { code: insertError.code, message: insertError.message });
      return NextResponse.json({ error: "Unable to create the contest. Confirm the process is a draft and you have manager access." }, { status });
    }

    const { data: contest, error: readError } = await supabase.from("contests")
      .select("id, process_id, title, description, display_order, created_at")
      .eq("id", contestId)
      .single();

    if (readError || !contest) {
      console.error("Contest was created but could not be loaded:", { code: readError?.code, message: readError?.message });
      return NextResponse.json({ error: "The contest was created but could not be loaded. Refresh the page." }, { status: 500 });
    }

    return NextResponse.json({ contest }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Contest creation failed:", code);
    return NextResponse.json({ error: "Unable to create the contest." }, { status: 500 });
  }
}
