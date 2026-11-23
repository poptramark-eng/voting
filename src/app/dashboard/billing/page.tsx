import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type BillingPageProps = {
  searchParams: Promise<{ reference?: string }>;
};

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/auth/login?returnTo=/dashboard/billing");

  const { reference } = await searchParams;
  const supabase = await createSupabaseServerClient();

  if (!reference || reference.length > 120) {
    return (
      <main className="shell" style={{ paddingTop: 48, paddingBottom: 64 }}>
        <section className="panel">
          <p className="eyebrow">Organization billing</p>
          <h1 style={{ fontSize: 30 }}>Payment status</h1>
          <p className="muted">No payment reference was supplied.</p>
          <Link className="button secondary" href="/dashboard">Return to dashboard</Link>
        </section>
      </main>
    );
  }

  const { data: payment, error } = await supabase
    .from("payment_transactions")
    .select("provider_reference, price_code, amount_minor, currency, status, created_at")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (error || !payment) {
    return (
      <main className="shell" style={{ paddingTop: 48, paddingBottom: 64 }}>
        <section className="panel">
          <p className="eyebrow">Organization billing</p>
          <h1 style={{ fontSize: 30 }}>Payment not available</h1>
          <p className="muted">
            This payment could not be found, or your account does not have permission to view it.
          </p>
          <Link className="button secondary" href="/dashboard">Return to dashboard</Link>
        </section>
      </main>
    );
  }

  const statusCopy: Record<string, string> = {
    INITIALIZING: "Checkout is being prepared.",
    PENDING: "We are waiting for Paystack's verified payment notification. This page can be refreshed.",
    SUCCEEDED: "Paystack verification succeeded and the payment has been recorded.",
    FAILED: "Checkout could not be completed. Start a new checkout if payment was not taken.",
    ABANDONED: "This checkout was abandoned.",
    REFUNDED: "This payment has been marked as refunded.",
  };

  return (
    <main className="shell" style={{ paddingTop: 48, paddingBottom: 64 }}>
      <section className="panel">
        <p className="eyebrow">Organization billing</p>
        <h1 style={{ fontSize: 30 }}>Payment status</h1>
        <p className="muted">{statusCopy[payment.status] ?? "Payment status is being reviewed."}</p>
        <div className="stack" style={{ marginTop: 20 }}>
          <div className="membership">
            <span className="muted">Status</span>
            <strong>{payment.status.replaceAll("_", " ")}</strong>
          </div>
          <div className="membership">
            <span className="muted">Amount</span>
            <strong>{payment.currency.trim()} {(payment.amount_minor / 100).toFixed(2)}</strong>
          </div>
          <div className="membership">
            <span className="muted">Billing item</span>
            <strong>{payment.price_code}</strong>
          </div>
          <div className="membership">
            <span className="muted">Reference</span>
            <strong style={{ overflowWrap: "anywhere" }}>{payment.provider_reference}</strong>
          </div>
        </div>
        {payment.status === "SUCCEEDED" && (
          <p className="muted" style={{ marginTop: 16 }}>
            The payment is recorded in the billing ledger. Subscription entitlements and plan provisioning
            are a separate next implementation step.
          </p>
        )}
        <div className="actions">
          <Link className="button secondary" href="/dashboard">Return to dashboard</Link>
          <Link className="button" href={`/dashboard/billing?reference=${encodeURIComponent(payment.provider_reference)}`}>Refresh status</Link>
        </div>
      </section>
    </main>
  );
}
