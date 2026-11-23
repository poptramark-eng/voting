import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processPaystackWebhookEvent } from "@/lib/payments/process-webhook";

export const runtime = "nodejs";

function hasValidCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice(7);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: events, error } = await admin
    .from("payment_webhook_events")
    .select("event_key, status, attempt_count, next_attempt_at, processing_started_at")
    .in("status", ["RECEIVED", "FAILED", "PROCESSING"])
    .order("received_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Unable to list pending Paystack webhook events:", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Unable to load pending webhook events." }, { status: 500 });
  }

  const now = Date.now();
  const eligible = (events ?? []).filter((event) => {
    if (event.status === "RECEIVED") return true;
    if (event.attempt_count >= 5) return false;
    if (event.status === "FAILED") {
      return event.next_attempt_at !== null && new Date(event.next_attempt_at).getTime() <= now;
    }
    return (
      event.status === "PROCESSING" &&
      event.processing_started_at !== null &&
      new Date(event.processing_started_at).getTime() <= now - 10 * 60 * 1000
    );
  });

  const results = await Promise.allSettled(
    eligible.map((event) => processPaystackWebhookEvent(event.event_key))
  );
  const processed = results.filter(
    (result) => result.status === "fulfilled" && result.value
  ).length;
  const failed = results.filter((result) => result.status === "rejected").length;

  return NextResponse.json({
    scanned: events?.length ?? 0,
    attempted: eligible.length,
    processed,
    failed,
  });
}
