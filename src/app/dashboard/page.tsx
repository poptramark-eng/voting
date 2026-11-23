import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";

export default async function DashboardPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login?returnTo=/dashboard");
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Authenticated session</p>
        <h1 style={{ fontSize: 36 }}>Welcome{session.user.name ? `, ${session.user.name}` : ""}.</h1>
        <p className="muted">
          Authentication is connected. Organization membership and permissions
          will be loaded from the application database, not inferred from Auth0 profile claims.
        </p>
        <p className="muted">Identity subject: {session.user.sub}</p>
        <a className="button secondary" href="/auth/logout">Sign out</a>
      </section>
    </main>
  );
}
