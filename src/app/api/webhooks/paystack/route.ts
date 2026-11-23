import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  createWebhookEventKey,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from "@/lib/payments/paystack";

export const runtime = "nodejs";

type PaystackWebhook = {
  event?: unknown;
  data?: {
    reference?: unknown;
  };
};

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!verifyPaystackWebhookSignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: PaystackWebhook;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as PaystackWebhook;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  if (typeof payload.event !== "string") {
    return NextResponse.json({ error: "Invalid webhook event." }, { status: 400 });
  }

  // Other Paystack events are acknowledged but do not alter the payment ledger yet.
  if (payload.event !== "charge.success") {
    return NextResponse.json({ received: true });
  }

  const reference = payload.data?.reference;
  if (typeof reference !== "string" || reference.length < 8 || reference.length > 120) {
    return NextResponse.json({ error: "Invalid transaction reference." }, { status: 400 });
  }

  try {
    // A signed webhook is a notification, not the sole source of payment truth.
    // Verify the transaction directly with Paystack before updating the ledger.
    const transaction = await verifyPaystackTransaction(reference);
    if (
      transaction.status !== "success" ||
      transaction.reference !== reference ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount <= 0 ||
      typeof transaction.currency !== "string"
    ) {
      return NextResponse.json({ error: "Transaction verification did not confirm success." }, { status: 409 });
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.rpc("complete_paystack_payment", {
      target_reference: reference,
      target_amount_minor: transaction.amount,
      target_currency: transaction.currency,
      target_provider_transaction_id: String(transaction.id),
      target_event_key: createWebhookEventKey(rawBody),
      target_event_type: payload.event,
    });

    if (error) {
      console.error("Paystack settlement update failed:", { code: error.code, message: error.message });
      return NextResponse.json({ error: "Unable to record verified payment." }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Paystack webhook processing failed:", code);
    return NextResponse.json({ error: "Webhook processing is temporarily unavailable." }, { status: 500 });
  }
}
