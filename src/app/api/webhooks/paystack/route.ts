import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createWebhookEventKey, verifyPaystackWebhookSignature } from "@/lib/payments/paystack";
import { processPaystackWebhookEvent } from "@/lib/payments/process-webhook";

export const runtime = "nodejs";

type PaystackWebhook = {
  event?: unknown;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!verifyPaystackWebhookSignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: PaystackWebhook;
  try {
    const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }
    payload = parsed as PaystackWebhook;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  if (typeof payload.event !== "string") {
    return NextResponse.json({ error: "Invalid webhook event." }, { status: 400 });
  }

  // Other event types are acknowledged; this first increment handles charge.success only.
  if (payload.event !== "charge.success") {
    return NextResponse.json({ received: true, ignored: true });
  }

  if (!isRecord(payload.data)) {
    return NextResponse.json({ error: "Invalid transaction event data." }, { status: 400 });
  }

  const reference = payload.data.reference;
  const amount = payload.data.amount;
  const currency = payload.data.currency;
  const transactionId = payload.data.id;

  if (
    typeof reference !== "string" ||
    reference.length < 8 ||
    reference.length > 120 ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency) ||
    (typeof transactionId !== "number" && typeof transactionId !== "string")
  ) {
    return NextResponse.json({ error: "Invalid transaction event data." }, { status: 400 });
  }

  const eventKey = createWebhookEventKey(rawBody);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("payment_webhook_events").upsert(
    {
      event_key: eventKey,
      event_type: payload.event,
      provider_reference: reference,
      event_data: {
        amount_minor: amount,
        currency,
        provider_transaction_id: String(transactionId),
      },
      status: "RECEIVED",
    },
    { onConflict: "event_key", ignoreDuplicates: true }
  );

  if (error) {
    console.error("Unable to persist Paystack webhook event:", { code: error.code, message: error.message });
    return NextResponse.json({ error: "Unable to persist webhook event." }, { status: 500 });
  }

  // Persist first, acknowledge immediately, then process after the response.
  // The inbox row is durable if the background task is interrupted.
  after(async () => {
    try {
      await processPaystackWebhookEvent(eventKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UNKNOWN";
      console.error("Background Paystack webhook processing failed:", message);
    }
  });

  return NextResponse.json({ received: true });
}
