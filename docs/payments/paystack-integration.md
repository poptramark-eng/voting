# Paystack billing integration

Status: server-side checkout and verified webhook foundation implemented on a feature branch. No live credentials, pricing or hosted migration have been configured.

## Decision and scope

Paystack is the selected provider for platform-level organization billing. The initial integration supports organization subscriptions and platform service-fee price codes.

This implementation does not collect voter participation fees, split payments, issue payouts, manage refunds, or activate subscription entitlements. Payment is never proof of voter eligibility, ballot submission or result certification. Do not connect a payment event to a ballot record.

## Configuration

Set these values in local environment and Vercel server-side environment variables:

| Variable | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack test or live API secret; server only |
| `PAYSTACK_WEBHOOK_SECRET` | Current Paystack webhook signing secret beginning with `whsec_`; server only |
| `PAYSTACK_WEBHOOK_SECRET_PREVIOUS` | Optional previous signing secret during rotation overlap; server only |
| `PAYSTACK_PRICE_CATALOG_JSON` | Server-controlled price catalog |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for narrowly scoped payment-ledger writes |
| `APP_BASE_URL` | Public application base URL used for Paystack callback |

Never prefix these secrets with `NEXT_PUBLIC_`. Never commit actual values. Start with Paystack test keys and test webhook signing secret.

### Price catalog

The browser sends only a `priceCode`; it cannot set the amount or currency. Configure the trusted catalog on the server:

```json
{
  "org-monthly": {
    "amountMinor": 10000,
    "currency": "KES",
    "description": "Illustrative organization monthly plan"
  }
}
```

The amount above is an example only, not a proposed platform price. Agree commercial pricing before configuring any price code. `amountMinor` is the amount in the currency's smallest unit (KES cents). The server currently accepts Paystack currencies KES, USD, NGN, GHS, ZAR and XOF, enforces the published minimums (KES 300, USD 200, NGN 5,000, GHS 10, ZAR 100, XOF 100 in subunits) and a 10,000,000-subunit maximum. Confirm current Paystack market and transaction limits before launch. The selected price currency must match the organization's configured default currency.

## Checkout API

`POST /api/billing/checkout`

Headers:
- Auth0 session cookie.
- `Content-Type: application/json`.
- `Idempotency-Key: <unique-key>` (8–128 permitted characters).

Body:

```json
{
  "organizationId": "organization-uuid",
  "priceCode": "org-monthly"
}
```

Only active organization OWNER, ADMIN and BILLING_MANAGER memberships can initiate checkout. The route loads amount and currency from server configuration, creates a payment-ledger row, then initializes Paystack. The response contains `authorizationUrl` and `reference`; redirect the browser to the authorization URL.

Repeating a request with the same organization and idempotency key returns the existing pending checkout URL or a conflict if that key has already been used for a non-pending transaction.

## Webhook and verification

Configure Paystack to send webhooks to:

`https://<your-domain>/api/webhooks/paystack`

The handler:
1. Reads the raw request body.
2. Verifies the timestamped `Paystack-Signature` HMAC-SHA512 header with the current or optional previous webhook signing secret, including a 300-second timestamp tolerance. Multiple `v1` signatures are checked to support secret rotation overlap. A legacy `X-Paystack-Signature` verification path is retained for integrations that have not yet enabled the signing secret.
3. For `charge.success`, independently calls Paystack's transaction verification endpoint.
4. Checks the verified reference, status, amount and currency against the server-created payment row.
5. Calls a service-role-only database function that atomically marks the payment successful, records a minimal webhook idempotency event and appends an audit event.

The callback route `/dashboard/billing?reference=...` is informational only. A browser redirect never marks a payment as successful. The webhook and server-side verification are authoritative.

Raw webhook bodies are not stored. Payment records contain organization, initiator, amount, currency, price code and provider references, but not card data.

## Database

Migration: `supabase/migrations/20261123160000_process_lifecycle_and_payments.sql`

- `payment_transactions`: organization billing ledger; read access is limited to OWNER, ADMIN and BILLING_MANAGER.
- `payment_webhook_events`: minimal event-key deduplication; no authenticated client access.
- `public.complete_paystack_payment`: callable only by `service_role`; checks amount/currency and updates the ledger and audit evidence atomically.

The service-role client is isolated in `src/lib/supabase/admin.ts` and used only by billing routes. It must never be imported into client components.

## Test checklist

1. Configure Paystack test secret and webhook signing secret.
2. Configure one internal price code with an agreed test amount in `PAYSTACK_PRICE_CATALOG_JSON`.
3. Confirm a MEMBER or OBSERVER cannot create checkout; OWNER, ADMIN and BILLING_MANAGER can.
4. Confirm the request rejects a price code absent from the server catalog and a currency mismatch.
5. Repeat the same request with the same `Idempotency-Key`; verify it reuses the existing checkout.
6. Complete a Paystack test payment and confirm the server verifies the reference, amount and currency.
7. Deliver the same signed webhook more than once; verify the ledger and audit event are not duplicated.
8. Alter the body or signature and confirm the webhook returns 401.
9. Confirm a browser callback without a successful webhook does not mark the payment successful.
10. Confirm payment success does not grant voter eligibility or create a ballot.

## Provider references

- [Paystack transaction API](https://paystack.com/docs/api/transaction/)
- [Paystack webhooks and signature verification](https://paystack.com/docs/payments/webhooks/)
- [Paystack Kenya payment methods](https://paystack.com/docs/v2/ke/payments/)
- [Paystack M-PESA integration](https://paystack.com/docs/v2/ke/payments/channels/mpesa)

Paystack documents hosted Checkout for Kenya with available channels including M-PESA, cards, Airtel Money, PesaLink and Apple Pay where enabled. This implementation leaves channel selection to the Paystack Dashboard/hosted Checkout configuration. Validate the current merchant onboarding, country, currency, fee, settlement, refund and compliance terms for the actual business before production use.
