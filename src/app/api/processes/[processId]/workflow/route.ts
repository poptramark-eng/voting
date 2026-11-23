import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

type RouteContext = { params: Promise<{ processId: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorStatus(code?: string): number {
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505") return 409;
  if (code === "22023") return 400;
  return 500;
}

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
    if (!isRecord(parsed)) throw new Error("Invalid body");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  const action = body.action;
  if (typeof action !== "string") {
    return NextResponse.json({ error: "A workflow action is required." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();

    if (action === "submit_for_approval") {
      const { data, error } = await supabase.rpc("submit_process_for_approval", {
        target_process: processId,
      });
      if (error) {
        console.error("Process submission failed:", { code: error.code, message: error.message });
        return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
      }
      return NextResponse.json({ requestId: data }, { status: 201 });
    }

    if (action === "open_scheduled" || action === "close_expired") {
      const result =
        action === "open_scheduled"
          ? await supabase.rpc("open_scheduled_process", { target_process: processId })
          : await supabase.rpc("close_expired_process", { target_process: processId });

      if (result.error) {
        console.error("Scheduled lifecycle transition failed:", {
          action,
          code: result.error.code,
          message: result.error.message,
        });
        return NextResponse.json(
          { error: result.error.message },
          { status: errorStatus(result.error.code) }
        );
      }

      return NextResponse.json({ lifecycleEventId: result.data });
    }

    if (action === "emergency_suspend" || action === "request_termination") {
      const reason = body.reason;
      if (typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 2000) {
        return NextResponse.json({ error: "Provide a reason between 10 and 2000 characters." }, { status: 400 });
      }
      const evidence = isRecord(body.evidence) ? (body.evidence as Json) : ({} as Json);

      const result =
        action === "emergency_suspend"
          ? await supabase.rpc("emergency_suspend_process", {
              target_process: processId,
              reason: reason.trim(),
              evidence,
            })
          : await supabase.rpc("request_process_termination", {
              target_process: processId,
              reason: reason.trim(),
              evidence,
            });

      if (result.error) {
        console.error("Process workflow action failed:", {
          action,
          code: result.error.code,
          message: result.error.message,
        });
        return NextResponse.json(
          { error: result.error.message },
          { status: errorStatus(result.error.code) }
        );
      }

      return NextResponse.json(
        action === "emergency_suspend"
          ? { lifecycleEventId: result.data }
          : { requestId: result.data },
        { status: 201 }
      );
    }

    if (action === "request_resumption") {
      const reason = body.reason;
      const reviewOutcome = body.reviewOutcome;
      const correctiveActions = body.correctiveActions ?? [];

      if (
        typeof reason !== "string" ||
        reason.trim().length < 10 ||
        reason.trim().length > 2000 ||
        typeof reviewOutcome !== "string" ||
        reviewOutcome.trim().length < 10 ||
        !Array.isArray(correctiveActions)
      ) {
        return NextResponse.json(
          { error: "A reason, documented review outcome and corrective-actions array are required." },
          { status: 400 }
        );
      }

      const { data, error } = await supabase.rpc("request_process_resumption", {
        target_process: processId,
        reason: reason.trim(),
        review_outcome: reviewOutcome.trim(),
        corrective_actions: correctiveActions as Json,
      });

      if (error) {
        console.error("Process resumption request failed:", {
          code: error.code,
          message: error.message,
        });
        return NextResponse.json({ error: error.message }, { status: errorStatus(error.code) });
      }

      return NextResponse.json({ requestId: data }, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported workflow action." }, { status: 400 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Process workflow request failed:", code);
    return NextResponse.json({ error: "Unable to complete the workflow request." }, { status: 500 });
  }
}
