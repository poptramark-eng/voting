import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { AcceptOrganizationInvitation } from "./accept-organization-invitation";

type PageProps = { searchParams: Promise<{ token?: string }> };

export default async function AcceptInvitationPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return (
      <main className="shell" style={{ maxWidth: 640, paddingTop: 80, paddingBottom: 80 }}>
        <section className="panel">
          <p className="eyebrow">Organization invitation</p>
          <h1 style={{ fontSize: 28 }}>Invalid invitation link</h1>
          <p className="muted">The invitation link is missing or malformed. Ask the organization administrator to create a new invitation.</p>
          <Link className="button secondary" href="/dashboard">Go to dashboard</Link>
        </section>
      </main>
    );
  }

  const session = await auth0.getSession();
  if (!session?.user.sub) {
    const returnTo = `/auth/accept-invitation?token=${encodeURIComponent(token)}`;
    redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <main className="shell" style={{ maxWidth: 640, paddingTop: 80, paddingBottom: 80 }}>
      <section className="panel">
        <p className="eyebrow">Organization invitation</p>
        <h1 style={{ fontSize: 28 }}>Join an organization</h1>
        <p className="muted">
          Signed in as {session.user.email ?? "your Auth0 account"}. To protect the organization, the email on your authenticated account must be verified and match the invitation.
        </p>
        <AcceptOrganizationInvitation token={token} />
      </section>
    </main>
  );
}
