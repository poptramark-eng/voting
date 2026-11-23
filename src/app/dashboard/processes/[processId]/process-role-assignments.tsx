"use client";

import { useState, type FormEvent } from "react";

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  status: string;
};

type Assignment = {
  id: string;
  user_id: string;
  role: "ELECTION_MANAGER" | "AUDITOR" | "OBSERVER";
  status: string;
  expires_at: string | null;
  created_at: string;
};

type Props = {
  processId: string;
  initialMembers: Member[];
  initialEventAssignments: Assignment[];
  initialProcessAssignments: Assignment[];
};

export function ProcessRoleAssignments({
  processId,
  initialMembers,
  initialEventAssignments,
  initialProcessAssignments,
}: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [eventAssignments, setEventAssignments] = useState(initialEventAssignments);
  const [assignments, setAssignments] = useState(initialProcessAssignments);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Assignment["role"]>("ELECTION_MANAGER");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/processes/${processId}/assignments`, { cache: "no-store" });
    const payload = await response.json() as {
      members?: Member[];
      eventAssignments?: Assignment[];
      processAssignments?: Assignment[];
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? "Unable to refresh process assignments.");
    setMembers(payload.members ?? []);
    setEventAssignments(payload.eventAssignments ?? []);
    setAssignments(payload.processAssignments ?? []);
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/processes/${processId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          role,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to assign process role.");
      setNotice("Process role assignment saved. The database checks that it does not exceed the member's event-level permissions.");
      setExpiresAt("");
      await refresh();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Unable to assign process role.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(assignment: Assignment) {
    setRevokingUserId(assignment.user_id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/processes/${processId}/assignments/${assignment.user_id}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to revoke process role.");
      setNotice("Process-level assignment revoked. The event-level assignment remains unchanged.");
      await refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Unable to revoke process role.");
    } finally {
      setRevokingUserId(null);
    }
  }

  // The server supplies newest-first history; reverse it so the newest row wins per member.
  const eventAssignmentByUser = new Map(eventAssignments.slice().reverse().map((assignment) => [assignment.user_id, assignment]));
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const eligibleMembers = members.filter((member) => eventAssignmentByUser.get(member.user_id)?.status === "ACTIVE");

  return (
    <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
      <p className="eyebrow">Scoped access</p>
      <h2 style={{ fontSize: 24, margin: "8px 0" }}>Process role assignments</h2>
      <p className="muted">
        A process role narrows an existing event-level role. It cannot grant permissions the member does not already hold at event scope.
      </p>
      {error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}

      <form onSubmit={assign} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 18 }}>
        <label style={{ flex: "1 1 240px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Event-assigned member</span>
          <select
            required
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          >
            <option value="">Select an event-assigned member</option>
            {eligibleMembers.map((member) => {
              const eventAssignment = eventAssignmentByUser.get(member.user_id);
              return (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name || member.email || member.user_id}
                  {eventAssignment ? ` · ${eventAssignment.role.replaceAll("_", " ")}` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label style={{ flex: "0 1 200px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Narrower process role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Assignment["role"])}
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          >
            <option value="ELECTION_MANAGER">Election manager</option>
            <option value="AUDITOR">Auditor</option>
            <option value="OBSERVER">Observer</option>
          </select>
        </label>
        <label style={{ flex: "0 1 220px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Expiry (optional)</span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          />
        </label>
        <button className="button" type="submit" disabled={saving || !userId || eligibleMembers.length === 0}>
          {saving ? "Saving…" : "Assign role"}
        </button>
      </form>
      {eligibleMembers.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>No active event-level assignments are available for narrowing in this process.</p>
      )}

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Process assignment history ({assignments.length})</h3>
        {assignments.length === 0 ? (
          <p className="muted">No process-level roles have been assigned. Members use their event-level role.</p>
        ) : (
          <div className="stack">
            {assignments.map((assignment) => {
              const member = memberById.get(assignment.user_id);
              const eventAssignment = eventAssignmentByUser.get(assignment.user_id);
              return (
                <article className="membership" key={assignment.id}>
                  <div>
                    <strong>{member?.display_name || member?.email || "Former organization member"}</strong>
                    <p className="muted">
                      Event: {eventAssignment?.role.replaceAll("_", " ") ?? "No active event assignment"}
                      {" · "}Process: {assignment.role.replaceAll("_", " ")} · {assignment.status}
                    </p>
                    <p className="muted">
                      {assignment.expires_at
                        ? `Expires ${new Date(assignment.expires_at).toLocaleString()}`
                        : "No scheduled expiry"}
                    </p>
                  </div>
                  {assignment.status === "ACTIVE" && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={revokingUserId === assignment.user_id}
                      onClick={() => revoke(assignment)}
                    >
                      {revokingUserId === assignment.user_id ? "Revoking…" : "Revoke process role"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          The database checks both event and process assignment expiry on every authorized operation. Expired rows may remain marked ACTIVE in history.
        </p>
      </div>
    </section>
  );
}
