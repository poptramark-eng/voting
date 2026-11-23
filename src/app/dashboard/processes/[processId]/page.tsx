import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProcessConfiguration } from "./process-configuration";

type PageProps = { params: Promise<{ processId: string }> };

type BallotItem = {
  id: string;
  item_type: string;
  label: string;
  description: string | null;
  display_order: number;
};

export default async function ProcessWorkspacePage({ params }: PageProps) {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/auth/login?returnTo=/dashboard");

  const { processId } = await params;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(processId)) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: appUser } = await supabase.from("app_users").select("id")
    .eq("auth_subject", session.user.sub).maybeSingle();
  if (!appUser) notFound();

  const { data: process } = await supabase.from("voting_processes")
    .select("id, event_id, title, status, ballot_format, eligibility_mode, assurance_tier, opens_at, closes_at")
    .eq("id", processId).maybeSingle();
  if (!process) notFound();

  const [{ data: event }, { data: membership }] = await Promise.all([
    supabase.from("voting_events").select("id, organization_id, title")
      .eq("id", process.event_id).maybeSingle(),
    supabase.from("organization_memberships").select("id, role")
      .eq("user_id", appUser.id).eq("status", "ACTIVE").maybeSingle(),
  ]);
  if (!event || !membership) notFound();

  const [{ data: eventAssignment }, { data: processAssignment }] = await Promise.all([
    supabase.from("event_role_assignments").select("id, expires_at")
      .eq("event_id", event.id).eq("user_id", appUser.id)
      .eq("role", "ELECTION_MANAGER").eq("status", "ACTIVE").maybeSingle(),
    supabase.from("process_role_assignments").select("id, expires_at")
      .eq("process_id", processId).eq("user_id", appUser.id)
      .eq("role", "ELECTION_MANAGER").eq("status", "ACTIVE").maybeSingle(),
  ]);

  const now = Date.now();
  const assignmentIsActive = (assignment: { expires_at: string | null } | null) =>
    Boolean(assignment) && (!assignment?.expires_at || new Date(assignment.expires_at).getTime() > now);
  const canEdit = ["OWNER", "ADMIN"].includes(membership.role) ||
    assignmentIsActive(eventAssignment) || assignmentIsActive(processAssignment);

  const { data: contests, error: contestsError } = await supabase.from("contests")
    .select("id, title, description, display_order")
    .eq("process_id", processId).order("display_order", { ascending: true });
  if (contestsError) throw new Error("Unable to load process contests.");

  const contestIds = (contests ?? []).map((contest) => contest.id);
  let items: BallotItem[] = [];
  if (contestIds.length > 0) {
    const { data, error } = await supabase.from("ballot_items")
      .select("id, contest_id, item_type, label, description, display_order")
      .in("contest_id", contestIds).order("display_order", { ascending: true });
    if (error) throw new Error("Unable to load ballot items.");
    items = data ?? [];
  }

  const configuration = (contests ?? []).map((contest) => ({
    ...contest,
    items: items.filter((item) => item.contest_id === contest.id),
  }));

  return (
    <main className="shell" style={{ paddingTop: 40, paddingBottom: 64 }}>
      <p className="eyebrow">{event.title} · Process workspace</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>{process.title}</h1>
          <p className="muted">{process.ballot_format.replaceAll("_", " ")} · {process.eligibility_mode.replaceAll("_", " ")} · {process.assurance_tier} assurance</p>
          <p className="muted">{process.status.replaceAll("_", " ")} · {process.opens_at ? new Date(process.opens_at).toLocaleString() : "Opening time not set"} – {process.closes_at ? new Date(process.closes_at).toLocaleString() : "Closing time not set"}</p>
        </div>
        <Link className="button secondary" href={`/dashboard/events/${event.id}`}>Back to event</Link>
      </div>

      <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
        <p className="eyebrow">Ballot structure</p>
        <h2 style={{ fontSize: 24, margin: "8px 0" }}>Contests and ballot options</h2>
        <p className="muted">Organize the ballot into contests, positions or questions, then add the available candidates or options.</p>
        <ProcessConfiguration processId={processId} initialContests={configuration} canEdit={canEdit} />
      </section>
    </main>
  );
}
