import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  createWebhookEventKey,
  verifyPaystackWebhookSignature,
} from "../src/lib/payments/paystack.ts";

const rawBody = Buffer.from(JSON.stringify({
  event: "charge.success",
  data: { reference: "org-test-reference", amount: 10000, currency: "KES" },
}));

function timestampedSignature(body, secret, timestamp) {
  const digest = createHmac("sha512", secret)
    .update(String(timestamp))
    .update(".")
    .update(body)
    .digest("hex");
  return `t=${timestamp},v1=whk_test:${digest}`;
}

test("accepts a valid timestamped Paystack-Signature", () => {
  const secret = "whsec_test_signing_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  process.env.PAYSTACK_WEBHOOK_SECRET = secret;
  const headers = new Headers({
    "Paystack-Signature": timestampedSignature(rawBody, secret, timestamp),
  });

  assert.equal(verifyPaystackWebhookSignature(rawBody, headers), true);
});

test("rejects a body modified after signing", () => {
  const secret = "whsec_test_signing_secret";
  const timestamp = Math.floor(Date.now() / 1000);
  process.env.PAYSTACK_WEBHOOK_SECRET = secret;
  const headers = new Headers({
    "Paystack-Signature": timestampedSignature(rawBody, secret, timestamp),
  });

  assert.equal(
    verifyPaystackWebhookSignature(Buffer.from(rawBody.toString("utf8") + " "), headers),
    false
  );
});

test("rejects timestamped signatures outside the replay window", () => {
  const secret = "whsec_test_signing_secret";
  const timestamp = Math.floor(Date.now() / 1000) - 301;
  process.env.PAYSTACK_WEBHOOK_SECRET = secret;
  const headers = new Headers({
    "Paystack-Signature": timestampedSignature(rawBody, secret, timestamp),
  });

  assert.equal(verifyPaystackWebhookSignature(rawBody, headers), false);
});

test("supports the legacy X-Paystack-Signature header", () => {
  const secret = "sk_test_legacy_secret";
  process.env.PAYSTACK_SECRET_KEY = secret;
  delete process.env.PAYSTACK_WEBHOOK_SECRET;
  const signature = createHmac("sha512", secret).update(rawBody).digest("hex");
  const headers = new Headers({ "X-Paystack-Signature": signature });

  assert.equal(verifyPaystackWebhookSignature(rawBody, headers), true);
});

test("creates a deterministic SHA-256 webhook event key", () => {
  assert.equal(createWebhookEventKey(rawBody), createWebhookEventKey(Buffer.from(rawBody)));
  assert.notEqual(createWebhookEventKey(rawBody), createWebhookEventKey(Buffer.from("different")));
});
