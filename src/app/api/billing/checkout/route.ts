import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPaystackPrice, initializePaystackTransaction } from "@/lib/payments/paystack";

export const runtime = "nodejs";

type CheckoutBody = {
  organizationId?: unknown;
  priceCode?: unknown;
};

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user.sub) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!session.user.email) {
    return NextResponse.json({ error: "An account email is required for checkout." }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: "A valid Idempotency-Key header is required." }, { status: 400 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }

  if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: "A JSON object is required." }, { status: 400 });
  }
  const body = parsedBody as CheckoutBody;

  if (
    typeof body.organizationId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.organizationId) ||
    typeof body.priceCode !== "string" ||
    !/^[a-zA-Z0-9._-]{1,100}$/.test(body.priceCode)
  ) {
    return NextResponse.json({ error: "Organization and price code are required." }, { status: 400 });
  }

  try {
    const price = getPaystackPrice(body.priceCode);
    if (!price) {
      return NextResponse.json({ error: "This billing option is not currently available." }, { status: 400 });
    }

    const userClient = await createSupabaseServerClient();
    const { data: appUser, error: userError } = await userClient
      .from("app_users")
      .select("id")
      .eq("auth_subject", session.user.sub)
      .maybeSingle();

    if (userError || !appUser) {
      return NextResponse.json({ error: "Application identity could not be resolved." }, { status: 403 });
    }

    const { data: membership, error: membershipError } = await userClient
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", body.organizationId)
      .eq("user_id", appUser.id)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (
      membershipError ||
      !membership ||
      !["OWNER", "ADMIN", "BILLING_MANAGER"].includes(membership.role)
    ) {
      return NextResponse.json({ error: "You do not have billing permission for this organization." }, { status: 403 });
    }

    const { data: organization, error: organizationError } = await userClient
      .from("organizations")
      .select("id, default_currency")
      .eq("id", body.organizationId)
      .maybeSingle();

    if (organizationError || !organization) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }

    if (organization.default_currency.trim() !== price.currency) {
      return NextResponse.json(
        { error: "The selected billing price currency does not match the organization's billing currency." },
        { status: 400 }
      );
    }

    const admin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("payment_transactions")
      .select("id, status, checkout_url, provider_reference")
      .eq("organization_id", body.organizationId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingError) throw new Error("PAYMENT_LOOKUP_FAILED");
    if (existing) {
      if (existing.status === "PENDING" && existing.checkout_url) {
        return NextResponse.json({
          authorizationUrl: existing.checkout_url,
          reference: existing.provider_reference,
          reused: true,
        });
      }
      return NextResponse.json(
        { error: "This idempotency key has already been used. Generate a new key for a new checkout." },
        { status: 409 }
      );
    }

    const reference = `org-${body.organizationId.slice(0, 8)}-${randomUUID()}`;
    const { data: payment, error: insertError } = await admin
      .from("payment_transactions")
      .insert({
        organization_id: body.organizationId,
        initiated_by: appUser.id,
        provider: "PAYSTACK",
        provider_reference: reference,
        idempotency_key: idempotencyKey,
        price_code: body.priceCode,
        amount_minor: price.amountMinor,
        currency: price.currency,
        status: "INITIALIZING",
      })
      .select("id")
      .single();

    if (insertError || !payment) {
      console.error("Payment intent creation failed:", insertError?.message);
      return NextResponse.json({ error: "Unable to create the payment request." }, { status: 500 });
    }

    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error("APP_BASE_URL_MISSING");

    const callbackUrl = new URL("/dashboard/billing", baseUrl);
    callbackUrl.searchParams.set("reference", reference);

    try {
      const initialized = await initializePaystackTransaction({
        email: session.user.email,
        amountMinor: price.amountMinor,
        currency: price.currency,
        reference,
        callbackUrl: callbackUrl.toString(),
        metadata: {
          organizationId: body.organizationId,
          paymentId: payment.id,
          priceCode: body.priceCode,
        },
      });

      if (initialized.reference !== reference) {
        throw new Error("PAYSTACK_REFERENCE_MISMATCH");
      }

      const { error: updateError } = await admin
        .from("payment_transactions")
        .update({
          status: "PENDING",
          checkout_url: initialized.authorization_url,
          provider_transaction_id: initialized.id ? String(initialized.id) : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("status", "INITIALIZING");

      if (updateError) throw new Error("PAYMENT_CHECKOUT_RECORD_FAILED");

      return NextResponse.json({
        authorizationUrl: initialized.authorization_url,
        reference,
      });
    } catch (error) {
      await admin
        .from("payment_transactions")
        .update({ status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", payment.id)
        .eq("status", "INITIALIZING");

      const code = error instanceof Error ? error.message : "UNKNOWN";
      console.error("Paystack checkout initialization failed:", code);
      return NextResponse.json({ error: "The payment provider could not initialize checkout." }, { status: 502 });
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    console.error("Billing checkout failed:", code);
    return NextResponse.json({ error: "Billing checkout is not configured or temporarily unavailable." }, { status: 503 });
  }
}
