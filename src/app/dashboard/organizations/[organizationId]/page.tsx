import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreateEventForm } from "./create-event-form";
import { OrganizationMembers } from "./organization-members";

type PageProps = { params: Promise<{ organizationId: string }> };

const categoryLabels: Record<string, string> = {
  GENERAL_POLL: "General poll",
  CONTEST: "Contest",
  ORGANIZATIONAL_ELECTION: "Organizational election",
  PUBLIC_ELECTION: "Public election",
};

export default async function OrganizationWorkspacePage({ params }: PageProps) {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/auth/login?returnTo=/dashboard");

  const { organizationId } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(organizationId)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: appUser } = await supabase
    .from("app_users")
    .select("id")
    .eq("auth_subject", session.user.sub)
    .maybeSingle();
  if (!appUser) notFound();

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", appUser.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!membership) notFound();

  const [{ data: organization }, { data: events, error: eventsError }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug").eq("id", organizationId).maybeSingle(),
    supabase
      .from("voting_events")
      .select("id, title, category, assurance_tier, status, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),
  ]);

  if (!organization) notFound();
  if (eventsError) throw new Error("Unable to load this organization's voting events.");

  const canCreate = ["OWNER", "ADMIN"].includes(membership.role);
  let initialMembers: Array<{
    membership_id: string;
    user_id: string;
    email: string | null;
    display_name: string | null;
    role: "OWNER" | "ADMIN" | "BILLING_MANAGER" | "MEMBER";
    status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
    created_at: string;
  }> = [];
  let initialInvitations: Array<{
    id: string;
    email: string;
    role: "ADMIN" | "BILLING_MANAGER" | "MEMBER";
    status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
    expires_at: string;
    created_at: string;
  }> = [];

  if (canCreate) {
    const [{ data: memberRows, error: memberError }, { data: invitationRows, error: invitationError }] = await Promise.all([
      supabase.rpc("list_organization_members", { target_org: organizationId }),
      supabase.rpc("list_organization_invitations", { target_org: organizationId }),
    ]);

    if (memberError || invitationError) {
      throw new Error("Unable to load organization membership administration.");
    }
    initialMembers = memberRows ?? [];
    initialInvitations = (invitationRows ?? []).map((invitation) => ({
      ...invitation,
      status: invitation.status as "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED",
    }));
  }

  return (
    <main className="shell" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <p className="eyebrow">Organization workspace</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>{organization.name}</h1>
          <p className="muted">/{organization.slug} · {membership.role.replaceAll("_", " ")}</p>
        </div>
        <Link className="button secondary" href="/dashboard">All organizations</Link>
      </div>

      <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p className="eyebrow">Election management</p>
            <h2 style={{ fontSize: 24, margin: "8px 0" }}>Voting events</h2>
            <p className="muted">Create and manage polls, contests and organizational elections.</p>
          </div>
          <strong style={{ fontSize: 28 }}>{events?.length ?? 0}</strong>
        </div>

        {events && events.length > 0 ? (
          <div className="stack">
            {events.map((event) => (
              <article className="membership" key={event.id}>
                <div>
                  <h3>{event.title}</h3>
                  <p className="muted">{categoryLabels[event.category] ?? event.category} · {event.assurance_tier} assurance</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span className="muted">{event.status.replaceAll("_", " ")}</span>
                  <Link className="button secondary" href={`/dashboard/events/${event.id}`}>Open event</Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 20 }}>No voting events have been created in this organization yet.</p>
        )}
      </section>

      {canCreate && (
        <OrganizationMembers
          organizationId={organizationId}
          currentUserId={appUser.id}
          isOwner={membership.role === "OWNER"}
          initialMembers={initialMembers}
          initialInvitations={initialInvitations}
        />
      )}

      {canCreate ? (
        <section className="panel" style={{ marginTop: 24 }}>
          <p className="eyebrow">New event</p>
          <h2 style={{ fontSize: 24, margin: "8px 0" }}>Create a voting event</h2>
          <p className="muted">An event can contain multiple independent voting processes.</p>
          <CreateEventForm organizationId={organizationId} />
        </section>
      ) : (
        <p className="muted" style={{ marginTop: 24 }}>Only organization owners and administrators can create events.</p>
      )}
    </main>
  );
}
