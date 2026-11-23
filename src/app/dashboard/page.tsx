import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login?returnTo=/dashboard");
  }

  const supabase = await createSupabaseServerClient();

  // This lookup is protected by app_users RLS and is scoped to the verified
  // Auth0 subject. The internal UUID is used for all application relationships.
  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    .select("id, email, display_name")
    .eq("auth_subject", session.user.sub)
    .single();

  if (appUserError || !appUser) {
    console.error("Unable to load the current application user:", appUserError);
    throw new Error("Your application identity could not be loaded.");
  }

  // RLS limits this result to active memberships in organizations the user belongs to.
  const { data: memberships, error: membershipsError } = await supabase
    .from("organization_memberships")
    .select("id, role, status, organization:organizations(id, name, slug)")
    .eq("user_id", appUser.id)
    .order("created_at", { ascending: true });

  if (membershipsError) {
    console.error("Unable to load organization memberships:", membershipsError);
    throw new Error("Your organization memberships could not be loaded.");
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Authenticated workspace</p>
        <h1 style={{ fontSize: 36 }}>
          Welcome{appUser.display_name ? `, ${appUser.display_name}` : ""}.
        </h1>
        <p className="muted">
          Your Auth0 identity is linked to an application account in Supabase.
          Organization access is resolved from database memberships and enforced by row-level security.
        </p>
        <p className="muted">Application user ID: {appUser.id}</p>
        <p className="muted">Email: {appUser.email ?? "Not provided"}</p>
        <a className="button secondary" href="/auth/logout">Sign out</a>
      </section>

      <section className="panel" style={{ marginTop: 24 }}>
        <p className="eyebrow">Your organizations</p>
        <h2 style={{ fontSize: 24 }}>Organization access</h2>
        {memberships.length === 0 ? (
          <p className="muted">
            You do not belong to an active organization yet. Organization setup and invitations will appear here.
          </p>
        ) : (
          <div className="stack">
            {memberships.map((membership) => (
              <article className="membership" key={membership.id}>
                <div>
                  <h3>{membership.organization.name}</h3>
                  <p className="muted">{membership.organization.slug}</p>
                </div>
                <p className="muted">
                  {membership.role.replaceAll("_", " ")} · {membership.status.toLowerCase()}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="muted" style={{ marginTop: 24 }}>
        <Link href="/">Return to home</Link>
      </p>
    </main>
  );
}
