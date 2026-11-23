import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreateOrganizationForm } from "./create-organization-form";

type DashboardPageProps = {
  searchParams: Promise<{ setup?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await auth0.getSession();

  if (!session?.user.sub) {
    redirect("/auth/login?returnTo=/dashboard");
  }

  const supabase = await createSupabaseServerClient();

  // The server client provisions the app_users row before returning.
  // maybeSingle gives us a controlled empty state if provisioning ever fails.
  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    .select("id, email, display_name")
    .eq("auth_subject", session.user.sub)
    .maybeSingle();

  if (appUserError || !appUser) {
    console.error("Unable to load the current application user:", appUserError);
    throw new Error("Your application identity could not be loaded. Please sign out and sign in again.");
  }

  // Only ACTIVE memberships grant workspace access. Invitations and suspended
  // or removed memberships must not be presented as usable organizations.
  const { data: memberships, error: membershipsError } = await supabase
    .from("organization_memberships")
    .select("id, role, status, organization:organizations(id, name, slug)")
    .eq("user_id", appUser.id)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: true });

  if (membershipsError) {
    console.error("Unable to load organization memberships:", membershipsError);
    throw new Error("Your organization memberships could not be loaded.");
  }

  const params = await searchParams;
  const setupMessage =
    params.setup === "created"
      ? "Your organization has been created. You are its owner."
      : params.setup === "exists"
        ? "That organization URL is already in use. Choose another."
        : params.setup === "invalid"
          ? "Enter a valid organization name and URL."
          : params.setup === "failed"
            ? "We could not create the organization. Please try again."
            : null;

  return (
    <main className="shell" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">Voting Platform · Workspace</p>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>
            Welcome{appUser.display_name ? `, ${appUser.display_name}` : ""}.
          </h1>
          <p className="muted">Manage your organizations, voting events and election processes.</p>
        </div>
        <a className="button secondary" href="/auth/logout">Sign out</a>
      </div>

      {setupMessage && (
        <p role="status" className="panel" style={{ marginTop: 20 }}>{setupMessage}</p>
      )}

      <section className="panel" style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p className="eyebrow">Overview</p>
            <h2 style={{ fontSize: 24, marginBottom: 6 }}>Your workspace</h2>
            <p className="muted">Signed in as {appUser.email ?? appUser.display_name ?? "your Auth0 account"}.</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong style={{ display: "block", fontSize: 30 }}>{memberships.length}</strong>
            <span className="muted">Active organizations</span>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 24 }}>
        <p className="eyebrow">Organizations</p>
        <h2 style={{ fontSize: 24 }}>Your organizations</h2>
        {memberships.length > 0 ? (
          <div className="stack">
            {memberships.map((membership) => {
              const organization = Array.isArray(membership.organization)
                ? membership.organization[0]
                : membership.organization;
              if (!organization) return null;

              return (
                <article className="membership" key={membership.id}>
                  <div>
                    <h3>{organization.name}</h3>
                    <p className="muted">/{organization.slug}</p>
                  </div>
                  <p className="muted">{membership.role.replaceAll("_", " ")}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div style={{ maxWidth: 640 }}>
            <p className="muted">
              You do not have an active organization yet. Create one to establish your workspace.
              You will automatically become its owner.
            </p>
            <CreateOrganizationForm />
          </div>
        )}
      </section>

      <p className="muted" style={{ marginTop: 24 }}>
        <Link href="/">Return to home</Link>
      </p>
    </main>
  );
}
