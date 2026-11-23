import Link from "next/link";
import { auth0 } from "@/lib/auth0";

export default async function HomePage() {
  const session = await auth0.getSession();

  return (
    <>
      <header className="topbar">
        <div className="shell" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link className="brand" href="/">Voting Platform</Link>
          <nav className="nav" aria-label="Main navigation">
            {session ? (
              <>
                <Link href="/dashboard">Dashboard</Link>
                <a href="/auth/logout">Sign out</a>
              </>
            ) : (
              <a href="/auth/login">Sign in</a>
            )}
          </nav>
        </div>
      </header>
      <main className="shell">
        <p className="eyebrow">Configurable voting infrastructure</p>
        <h1>Run trusted polls, contests and organizational elections.</h1>
        <p className="lead">
          A configurable platform for organizations to plan participation,
          manage voter eligibility, run voting processes and publish accountable results.
        </p>
        <div className="actions">
          {session ? (
            <Link className="button" href="/dashboard">Open dashboard</Link>
          ) : (
            <a className="button" href="/auth/login">Sign in</a>
          )}
          <a className="button secondary" href="https://github.com/poptramark-eng/voting">Project repository</a>
        </div>
      </main>
    </>
  );
}
