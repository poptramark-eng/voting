import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProcessConfiguration } from "./process-configuration";
import { ProcessLifecycleControls } from "./process-lifecycle-controls";
import { VoterRegisterImport } from "./voter-register-import";
import { VoterRegisterWorkspace } from "./voter-register-workspace";
import { VoterRegisterFinalization } from "./voter-register-finalization";
import { ProcessRoleAssignments } from "./process-role-assignments";

type PageProps = { params: Promise<{ processId: string }> };

type BallotItem = {
  id: string;
  contest_id: string;
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

  const { data: event } = await supabase.from("voting_events")
    .select("id, organization_id, title")
    .eq("id", process.event_id).maybeSingle();
  if (!event) notFound();

  const { data: membership } = await supabase.from("organization_memberships")
    .select("id, role")
    .eq("organization_id", event.organization_id)
    .eq("user_id", appUser.id)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (!membership) notFound();

  const canGovern = ["OWNER", "ADMIN"].includes(membership.role);
  const [
    { data: scopedCanEdit, error: editPermissionError },
    { data: scopedCanManageRegister, error: registerPermissionError },
    { data: scopedCanReadPii, error: piiPermissionError },
  ] = canGovern
    ? [
        { data: false, error: null },
        { data: false, error: null },
        { data: false, error: null },
      ]
    : await Promise.all([
        supabase.rpc("has_current_process_permission", {
          target_process: processId,
          target_permission: "process.update",
        }),
        supabase.rpc("has_current_process_permission", {
          target_process: processId,
          target_permission: "voter_register.manage",
        }),
        supabase.rpc("has_current_process_permission", {
          target_process: processId,
          target_permission: "voter_pii.read",
        }),
      ]);

  if (editPermissionError || registerPermissionError || piiPermissionError) {
    throw new Error("Unable to verify process-scoped permissions.");
  }

  // These checks include both event and process assignments, membership status and expiry.
  const canEdit = canGovern || Boolean(scopedCanEdit);
  const canManageRegister = canGovern || Boolean(scopedCanManageRegister);
  const canRequestPii = !canGovern && Boolean(scopedCanReadPii);

  let initialMembers: Array<{
    user_id: string;
    email: string | null;
    display_name: string | null;
    role: string;
    status: string;
  }> = [];
  let initialEventAssignments: Array<{
    id: string;
    user_id: string;
    role: "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER";
    status: string;
    expires_at: string | null;
    created_at: string;
  }> = [];
  let initialProcessAssignments: Array<{
    id: string;
    user_id: string;
    role: "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER";
    status: string;
    expires_at: string | null;
    created_at: string;
  }> = [];

  if (canGovern) {
    const [
      { data: memberRows, error: memberError },
      { data: eventAssignmentRows, error: eventAssignmentsError },
      { data: processAssignmentRows, error: processAssignmentsError },
    ] = await Promise.all([
      supabase.rpc("list_organization_members", { target_org: event.organization_id }),
      supabase.from("event_role_assignments")
        .select("id,user_id,role,status,expires_at,created_at")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false }),
      supabase.from("process_role_assignments")
        .select("id,user_id,role,status,expires_at,created_at")
        .eq("process_id", processId)
        .order("created_at", { ascending: false }),
    ]);

    if (memberError || eventAssignmentsError || processAssignmentsError) {
      throw new Error("Unable to load process-scoped role administration.");
    }

    initialMembers = (memberRows ?? []).filter((member) => member.status === "ACTIVE").map((member) => ({
      user_id: member.user_id,
      email: member.email,
      display_name: member.display_name,
      role: member.role,
      status: member.status,
    }));
    initialEventAssignments = (eventAssignmentRows ?? []).map((assignment) => ({
      ...assignment,
      role: assignment.role as "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER",
    }));
    initialProcessAssignments = (processAssignmentRows ?? []).map((assignment) => ({
      ...assignment,
      role: assignment.role as "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER",
    }));
  }

  type GovernanceApproval = {
    decision: string;
    comment: string | null;
    decided_at: string;
  };
  const { data: workflowRows, error: workflowError } = canGovern
    ? await supabase.from("process_workflow_requests")
        .select("id, action, status, reason, required_approvals, requested_at")
        .eq("process_id", processId)
        .order("requested_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  if (workflowError) throw new Error("Unable to load process governance requests.");

  const workflowIds = (workflowRows ?? []).map((request) => request.id);
  let workflowApprovals: Array<GovernanceApproval & { request_id: string }> = [];
  if (workflowIds.length > 0) {
    const { data, error } = await supabase.from("process_workflow_approvals")
      .select("request_id, decision, comment, decided_at")
      .in("request_id", workflowIds)
      .order("decided_at", { ascending: true });
    if (error) throw new Error("Unable to load governance approvals.");
    workflowApprovals = data ?? [];
  }
  const governanceRequests = (workflowRows ?? []).map((request) => ({
    ...request,
    approvals: workflowApprovals.filter((approval) => approval.request_id === request.id),
  }));

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
        <p className="eyebrow">Process governance</p>
        <h2 style={{ fontSize: 24, margin: "8px 0" }}>Lifecycle and approvals</h2>
        <p className="muted">Submit draft processes for approval, manage exceptional suspensions and review controlled lifecycle requests.</p>
        <ProcessLifecycleControls
          processId={processId}
          processStatus={process.status}
          canGovern={canGovern}
          requests={governanceRequests}
        />
      </section>

      {canGovern && (
        <ProcessRoleAssignments
          processId={processId}
          initialMembers={initialMembers}
          initialEventAssignments={initialEventAssignments}
          initialProcessAssignments={initialProcessAssignments}
        />
      )}

      <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
        <p className="eyebrow">Ballot structure</p>
        <h2 style={{ fontSize: 24, margin: "8px 0" }}>Contests and ballot options</h2>
        <p className="muted">Organize the ballot into contests, positions or questions, then add the available candidates or options.</p>
        <ProcessConfiguration processId={processId} initialContests={configuration} canEdit={canEdit} />
      </section>

      <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
        <VoterRegisterImport processId={processId} canEdit={canManageRegister && process.status === "DRAFT"} />
        <VoterRegisterWorkspace
          processId={processId}
          eventId={event.id}
          currentUserId={appUser.id}
          assuranceTier={process.assurance_tier}
          canManage={canManageRegister && process.status === "DRAFT"}
          canRequestPii={canRequestPii}
          canGovern={canGovern}
        />
        <VoterRegisterFinalization
          processId={processId}
          currentUserId={appUser.id}
          processStatus={process.status}
          canManage={canManageRegister && process.status === "DRAFT"}
          canGovern={canGovern}
        />
      </section>
    </main>
  );
}
