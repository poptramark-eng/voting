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
  eventId: string;
  initialMembers: Member[];
  initialAssignments: Assignment[];
};

export function EventRoleAssignments({ eventId, initialMembers, initialAssignments }: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Assignment["role"]>("ELECTION_MANAGER");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/events/${eventId}/assignments`, { cache: "no-store" });
    const payload = await response.json() as {
      members?: Member[];
      assignments?: Assignment[];
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? "Unable to refresh event assignments.");
    setMembers(payload.members ?? []);
    setAssignments(payload.assignments ?? []);
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${eventId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          role,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to assign event role.");
      setNotice("Event role assignment saved. Any previous process-level assignments for this member were revoked by the database.");
      setExpiresAt("");
      await refresh();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Unable to assign event role.");
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
        `/api/events/${eventId}/assignments/${assignment.user_id}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to revoke event role.");
      setNotice("Event role and all of this member's process-level assignments in the event were revoked.");
      await refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Unable to revoke event role.");
    } finally {
      setRevokingUserId(null);
    }
  }

  const memberById = new Map(members.map((member) => [member.user_id, member]));

  return (
    <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
      <p className="eyebrow">Scoped access</p>
      <h2 style={{ fontSize: 24, margin: "8px 0" }}>Event role assignments</h2>
      <p className="muted">
        Assign an active organization member to this event as an Election Manager, Auditor or Observer. Process-level assignments can narrow this role further.
      </p>
      {error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}

      <form onSubmit={assign} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 18 }}>
        <label style={{ flex: "1 1 240px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Organization member</span>
          <select
            required
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          >
            <option value="">Select a member</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name || member.email || member.user_id}
                {member.email ? ` · ${member.email}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: "0 1 200px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Scoped role</span>
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
        <button className="button" type="submit" disabled={saving || !userId}>
          {saving ? "Saving…" : "Assign role"}
        </button>
      </form>

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Assignment history ({assignments.length})</h3>
        {assignments.length === 0 ? (
          <p className="muted">No event-scoped roles have been assigned.</p>
        ) : (
          <div className="stack">
            {assignments.map((assignment) => {
              const member = memberById.get(assignment.user_id);
              return (
                <article className="membership" key={assignment.id}>
                  <div>
                    <strong>{member?.display_name || member?.email || "Former organization member"}</strong>
                    <p className="muted">{assignment.role.replaceAll("_", " ")} · {assignment.status}</p>
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
                      {revokingUserId === assignment.user_id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Expiry is checked by the database on every authorized operation. Expired records may remain marked ACTIVE in the history until revoked or replaced.
        </p>
      </div>
    </section>
  );
}
