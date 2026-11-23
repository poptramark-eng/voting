import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyPaystackTransaction } from "@/lib/payments/paystack";

type ClaimedWebhookEvent = {
  event_key: string;
  event_type: string;
  provider_reference: string;
  event_data: {
    amount_minor: number;
    currency: string;
    provider_transaction_id: string | null;
  };
};

function isClaimedWebhookEvent(value: unknown): value is ClaimedWebhookEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const data = record.event_data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const eventData = data as Record<string, unknown>;

  return (
    typeof record.event_key === "string" &&
    typeof record.event_type === "string" &&
    typeof record.provider_reference === "string" &&
    typeof eventData.amount_minor === "number" &&
    typeof eventData.currency === "string" &&
    (typeof eventData.provider_transaction_id === "string" ||
      eventData.provider_transaction_id === null)
  );
}

export async function processPaystackWebhookEvent(eventKey: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_paystack_webhook_event", {
    target_event_key: eventKey,
  });

  if (error) {
    console.error("Unable to claim Paystack webhook event:", { code: error.code, message: error.message });
    throw new Error("PAYSTACK_WEBHOOK_CLAIM_FAILED");
  }

  if (!data) return false;
  if (!isClaimedWebhookEvent(data)) {
    await admin.rpc("fail_paystack_webhook_event", {
      target_event_key: eventKey,
      error_message: "Stored webhook event data is invalid.",
    });
    return false;
  }

  try {
    const transaction = await verifyPaystackTransaction(data.provider_reference);
    if (
      transaction.status !== "success" ||
      transaction.reference !== data.provider_reference ||
      !Number.isSafeInteger(transaction.amount) ||
      transaction.amount <= 0 ||
      typeof transaction.currency !== "string"
    ) {
      throw new Error("PAYSTACK_TRANSACTION_NOT_CONFIRMED");
    }

    const { data: completed, error: completionError } = await admin.rpc("complete_paystack_payment", {
      target_reference: data.provider_reference,
      target_amount_minor: transaction.amount,
      target_currency: transaction.currency,
      target_provider_transaction_id: String(transaction.id),
      target_event_key: data.event_key,
      target_event_type: data.event_type,
    });

    if (completionError) {
      throw new Error("PAYSTACK_PAYMENT_LEDGER_UPDATE_FAILED");
    }

    return completed === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Paystack webhook processing error";
    const { error: failError } = await admin.rpc("fail_paystack_webhook_event", {
      target_event_key: eventKey,
      error_message: message,
    });

    if (failError) {
      console.error("Unable to mark Paystack webhook event for retry:", {
        code: failError.code,
        message: failError.message,
      });
    }

    throw error;
  }
}
