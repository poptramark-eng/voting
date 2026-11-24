import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

type RouteContext = { params: Promise<{ contestId: string }> };

const itemTypes = ["CANDIDATE", "TEAM", "GROUP", "PARTY", "PROPOSAL", "OPTION"] as const;

export async function POST(request: Request, context: RouteContext) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { contestId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(contestId)) {
    return NextResponse.json({ error: "Invalid contest identifier." }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  }

  const itemType = body.itemType;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const displayOrder = body.displayOrder ?? 0;
  const metadata =
    typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
      ? (body.metadata as Json)
      : ({} as Json);

  if (
    typeof itemType !== "string" ||
    !itemTypes.includes(itemType as (typeof itemTypes)[number]) ||
    label.length < 1 ||
    label.length > 200 ||
    (description !== null && description.length > 4000) ||
    typeof displayOrder !== "number" ||
    !Number.isInteger(displayOrder) ||
    displayOrder < 0
  ) {
    return NextResponse.json({ error: "Provide a valid ballot item type, label and display order." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const itemId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("ballot_items").insert({
      id: itemId,
      contest_id: contestId,
      item_type: itemType,
      label,
      description,
      display_order: displayOrder,
      metadata,
    });

    if (insertError) {
      const status = insertError.code === "42501" ? 403 : insertError.code === "23503" ? 404 : 400;
      console.error("Ballot item creation failed:", { code: insertError.code, message: insertError.message });
      return NextResponse.json({ error: "Unable to create the ballot item. Confirm the process is a draft and you have manager access." }, { status });
    }

    const { data: item, error: readError } = await supabase.from("ballot_items")
      .select("id, contest_id, item_type, label, description, display_order, created_at")
      .eq("id", itemId)
      .single();

    if (readError || !item) {
      console.error("Ballot item was created but could not be loaded:", { code: readError?.code, message: readError?.message });
      return NextResponse.json({ error: "The ballot item was created but could not be loaded. Refresh the page." }, { status: 500 });
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Ballot item creation failed:", code);
    return NextResponse.json({ error: "Unable to create the ballot item." }, { status: 500 });
  }
}
