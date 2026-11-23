import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreateProcessForm } from "./create-process-form";

type PageProps = { params: Promise<{ eventId: string }> };

const labels: Record<string, string> = {
  SINGLE_CHOICE: "Single choice",
  MULTIPLE_CHOICE: "Multiple choice",
  RANKED_CHOICE: "Ranked choice",
  YES_NO: "Yes / No",
  APPROVAL: "Approval",
  SCORED: "Scored",
};

export default async function EventWorkspacePage({ params }: PageProps) {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/auth/login?returnTo=/dashboard");

  const { eventId } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(eventId)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: appUser } = await supabase.from("app_users").select("id")
    .eq("auth_subject", session.user.sub).maybeSingle();
  if (!appUser) notFound();

  const { data: event } = await supabase.from("voting_events")
    .select("id, organization_id, title, description, category, assurance_tier, status")
    .eq("id", eventId).maybeSingle();
  if (!event) notFound();

  const { data: membership } = await supabase.from("organization_memberships")
    .select("id, role").eq("organization_id", event.organization_id)
    .eq("user_id", appUser.id).eq("status", "ACTIVE").maybeSingle();
  if (!membership) notFound();

  const [{ data: organization }, { data: processes, error }] = await Promise.all([
    supabase.from("organizations").select("id, name").eq("id", event.organization_id).maybeSingle(),
    supabase.from("voting_processes")
      .select("id, title, status, ballot_format, eligibility_mode, assurance_tier, opens_at, closes_at")
      .eq("event_id", eventId).order("created_at", { ascending: false }),
  ]);
  if (!organization) notFound();
  if (error) throw new Error("Unable to load voting processes.");

  const canCreate = ["OWNER", "ADMIN"].includes(membership.role);

  return (
    <main className="shell" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <p className="eyebrow">{organization.name} · Event workspace</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>{event.title}</h1>
          <p className="muted">{event.category.replaceAll("_", " ")} · {event.assurance_tier} assurance · {event.status}</p>
          {event.description ? <p className="muted">{event.description}</p> : null}
        </div>
        <Link className="button secondary" href={`/dashboard/organizations/${organization.id}`}>Back to organization</Link>
      </div>

      <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
        <p className="eyebrow">Voting processes</p>
        <h2 style={{ fontSize: 24, margin: "8px 0" }}>Processes in this event</h2>
        <p className="muted">Each process has its own ballot format, voter eligibility rules and schedule.</p>
        {processes && processes.length > 0 ? (
          <div className="stack">
            {processes.map((process) => (
              <article className="membership" key={process.id}>
                <div>
                  <h3>{process.title}</h3>
                  <p className="muted">{labels[process.ballot_format] ?? process.ballot_format} · {process.eligibility_mode.replaceAll("_", " ")}</p>
                  <p className="muted">{process.opens_at ? new Date(process.opens_at).toLocaleString() : "Not scheduled"} – {process.closes_at ? new Date(process.closes_at).toLocaleString() : "Not scheduled"}</p>
                </div>
                <strong>{process.status.replaceAll("_", " ")}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 20 }}>No processes have been configured for this event yet.</p>
        )}
      </section>

      {canCreate ? (
        <section className="panel" style={{ marginTop: 24 }}>
          <p className="eyebrow">New process</p>
          <h2 style={{ fontSize: 24, margin: "8px 0" }}>Configure a voting process</h2>
          <CreateProcessForm eventId={eventId} />
        </section>
      ) : (
        <p className="muted" style={{ marginTop: 24 }}>Only organization owners and administrators can configure processes from this workspace.</p>
      )}
    </main>
  );
}
