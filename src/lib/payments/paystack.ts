import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type PaystackPrice = {
  amountMinor: number;
  currency: string;
  description: string;
};

type PaystackEnvelope<T> = {
  status: boolean;
  message?: string;
  data?: T;
};

export type PaystackTransaction = {
  id: number | string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  metadata?: unknown;
};

type InitializeTransactionData = {
  authorization_url: string;
  access_code: string;
  reference: string;
  id?: number | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getPaystackPrice(priceCode: string): PaystackPrice | null {
  const rawCatalog = process.env.PAYSTACK_PRICE_CATALOG_JSON;
  if (!rawCatalog) return null;

  let catalog: unknown;
  try {
    catalog = JSON.parse(rawCatalog);
  } catch {
    throw new Error("PAYSTACK_PRICE_CATALOG_INVALID");
  }

  if (!isRecord(catalog)) throw new Error("PAYSTACK_PRICE_CATALOG_INVALID");
  const entry = catalog[priceCode];
  if (!isRecord(entry)) return null;

  const amountMinor = entry.amountMinor;
  const currency = entry.currency;
  const description = entry.description;

  const minimumAmounts: Record<string, number> = {
    KES: 300,
    USD: 200,
    NGN: 5000,
    GHS: 10,
    ZAR: 100,
    XOF: 100,
  };

  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    typeof currency !== "string" ||
    !(currency in minimumAmounts) ||
    amountMinor < minimumAmounts[currency] ||
    amountMinor > 10_000_000 ||
    typeof description !== "string" ||
    description.trim().length < 2
  ) {
    throw new Error("PAYSTACK_PRICE_CATALOG_INVALID");
  }

  return { amountMinor, currency, description: description.trim() };
}

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY_MISSING");
  return key;
}

export async function initializePaystackTransaction(input: {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<InitializeTransactionData> {
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: JSON.stringify(input.metadata),
    }),
    cache: "no-store",
  });

  const payload = (await response.json()) as PaystackEnvelope<InitializeTransactionData>;
  if (!response.ok || !payload.status || !payload.data?.authorization_url || !payload.data.reference) {
    throw new Error("PAYSTACK_INITIALIZATION_FAILED");
  }

  return payload.data;
}

export async function verifyPaystackTransaction(reference: string): Promise<PaystackTransaction> {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${getSecretKey()}` },
      cache: "no-store",
    }
  );

  const payload = (await response.json()) as PaystackEnvelope<PaystackTransaction>;
  if (!response.ok || !payload.status || !payload.data) {
    throw new Error("PAYSTACK_VERIFICATION_FAILED");
  }

  return payload.data;
}

function constantTimeHexEquals(expectedHex: string, actualHex: string): boolean {
  if (!/^[a-f0-9]{128}$/i.test(expectedHex) || !/^[a-f0-9]{128}$/i.test(actualHex)) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Supports Paystack's timestamped Paystack-Signature header and the legacy
 * X-Paystack-Signature header. Always verify the exact raw request bytes.
 */
export function verifyPaystackWebhookSignature(rawBody: Buffer, headers: Headers): boolean {
  const currentSignature = headers.get("paystack-signature");
  if (currentSignature) {
    const signingSecrets = [
      process.env.PAYSTACK_WEBHOOK_SECRET,
      process.env.PAYSTACK_WEBHOOK_SECRET_PREVIOUS,
    ].filter((secret): secret is string => Boolean(secret));
    if (signingSecrets.length === 0) return false;

    const parts = currentSignature.split(",");
    const timestampPart = parts.find((part) => part.trim().startsWith("t="));
    const timestamp = timestampPart?.trim().slice(2);
    if (!timestamp || !/^\d{10}$/.test(timestamp)) return false;

    const timestampSeconds = Number(timestamp);
    if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
      return false;
    }

    const signatures = parts
      .filter((part) => part.trim().startsWith("v1="))
      .map((part) => {
        const value = part.trim().slice(3);
        const separator = value.indexOf(":");
        return separator >= 0 ? value.slice(separator + 1) : value;
      });

    if (signatures.length === 0) return false;

    return signatures.some((signature) =>
      signingSecrets.some((secret) => {
        const expected = createHmac("sha512", secret)
          .update(timestamp)
          .update(".")
          .update(rawBody)
          .digest("hex");
        return constantTimeHexEquals(expected, signature);
      })
    );
  }

  const legacySignature = headers.get("x-paystack-signature");
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!legacySignature || !secretKey) return false;

  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return constantTimeHexEquals(expected, legacySignature);
}

export function createWebhookEventKey(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
