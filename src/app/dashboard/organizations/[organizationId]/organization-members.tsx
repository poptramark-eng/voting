"use client";

import { useState } from "react";
import type { FormEvent } from "react";

type Member = {
  membership_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: "OWNER" | "ADMIN" | "BILLING_MANAGER" | "MEMBER";
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  created_at: string;
};

type Invitation = {
  id: string;
  email: string;
  role: "ADMIN" | "BILLING_MANAGER" | "MEMBER";
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  expires_at: string;
  created_at: string;
  effectiveStatus?: string;
};

type Props = {
  organizationId: string;
  currentUserId: string;
  isOwner: boolean;
  initialMembers: Member[];
  initialInvitations: Invitation[];
};

type Draft = { role: Member["role"]; status: Member["status"] };

export function OrganizationMembers({
  organizationId,
  currentUserId,
  isOwner,
  initialMembers,
  initialInvitations,
}: Props) {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Invitation["role"]>("MEMBER");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/organizations/${organizationId}/members`, { cache: "no-store" });
    const payload = await response.json() as {
      members?: Member[];
      invitations?: Invitation[];
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? "Unable to refresh organization members.");
    setMembers(payload.members ?? []);
    setInvitations(payload.invitations ?? []);
  }

  function draftFor(member: Member): Draft {
    return drafts[member.user_id] ?? { role: member.role, status: member.status };
  }

  function setDraft(member: Member, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [member.user_id]: {
        ...(current[member.user_id] ?? { role: member.role, status: member.status }),
        ...patch,
      },
    }));
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    setInviteLink(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      const payload = await response.json() as {
        invitation?: { token?: string; email?: string; role?: string; expiresAt?: string };
        error?: string;
      };
      if (!response.ok || !payload.invitation?.token) {
        throw new Error(payload.error ?? "Unable to create the invitation.");
      }

      const link = new URL("/auth/accept-invitation", window.location.origin);
      link.searchParams.set("token", payload.invitation.token);
      setInviteLink(link.toString());
      setEmail("");
      setNotice("Invitation created. Copy the link and share it with the invitee through your chosen channel.");
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create the invitation.");
    } finally {
      setCreating(false);
    }
  }

  async function updateMember(member: Member) {
    const draft = draftFor(member);
    setSaving(member.user_id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: member.user_id,
          // Ownership changes are deliberately not offered here. A second active
          // OWNER must use the dedicated governance flow before this OWNER is removed.
          role: member.role === "OWNER" ? "MEMBER" : draft.role,
          status: draft.status,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update membership.");
      setNotice("Organization membership updated.");
      setDrafts((current) => {
        const next = { ...current };
        delete next[member.user_id];
        return next;
      });
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update membership.");
    } finally {
      setSaving(null);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    setRevoking(invitation.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/invitations/${invitation.id}/revoke`,
        { method: "POST" },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to revoke invitation.");
      setNotice("Invitation revoked.");
      await refresh();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Unable to revoke invitation.");
    } finally {
      setRevoking(null);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNotice("Invitation link copied.");
    } catch {
      setNotice("Select and copy the invitation link below.");
    }
  }

  return (
    <section className="panel" style={{ marginTop: 24, maxWidth: "none" }}>
      <p className="eyebrow">Organization access</p>
      <h2 style={{ fontSize: 24, margin: "8px 0" }}>Members and invitations</h2>
      <p className="muted">
        Manage organization-level roles. Event and process assignments remain separate and narrower than organization membership.
      </p>

      {error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}

      <form onSubmit={createInvitation} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 18 }}>
        <label style={{ flex: "1 1 240px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Invitee email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
            placeholder="person@example.com"
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          />
        </label>
        <label style={{ flex: "0 1 200px" }}>
          <span className="muted" style={{ display: "block", marginBottom: 6 }}>Organization role</span>
          <select
            value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as Invitation["role"])}
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          >
            <option value="MEMBER">Member</option>
            <option value="BILLING_MANAGER">Billing manager</option>
            {isOwner && <option value="ADMIN">Administrator</option>}
          </select>
        </label>
        <button className="button" type="submit" disabled={creating || !email.trim()}>
          {creating ? "Creating…" : "Create invitation"}
        </button>
      </form>

      {inviteLink && (
        <div className="membership" style={{ marginTop: 14, display: "block" }}>
          <strong>Invitation link</strong>
          <p className="muted">This link is shown only once. It expires after seven days and can only be accepted by a signed-in account with a verified matching email address.</p>
          <input
            aria-label="Invitation link"
            readOnly
            value={inviteLink}
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: "100%", padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8, marginTop: 8 }}
          />
          <button className="button secondary" type="button" onClick={copyInviteLink} style={{ marginTop: 8 }}>Copy invitation link</button>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Organization members ({members.length})</h3>
        <div className="stack">
          {members.map((member) => {
            const draft = draftFor(member);
            const isSelf = member.user_id === currentUserId;
            const canManageRow = !isSelf && (isOwner || (member.role !== "OWNER" && member.role !== "ADMIN"));
            return (
              <article className="membership" key={member.membership_id} style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong>{member.display_name || member.email || "Organization member"}</strong>
                  <p className="muted">{member.email ?? "No email address on file"}</p>
                  <p className="muted">Joined {new Date(member.created_at).toLocaleDateString()}</p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                  <label>
                    <span className="muted" style={{ display: "block", marginBottom: 4 }}>Role</span>
                    <select
                      value={member.role === "OWNER" ? "MEMBER" : draft.role}
                      disabled={!canManageRow || member.role === "OWNER"}
                      onChange={(event) => setDraft(member, { role: event.target.value as Member["role"] })}
                      style={{ padding: 8, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
                    >
                      <option value="MEMBER">Member</option>
                      <option value="BILLING_MANAGER">Billing manager</option>
                      {isOwner && <option value="ADMIN">Administrator</option>}
                    </select>
                  </label>
                  <label>
                    <span className="muted" style={{ display: "block", marginBottom: 4 }}>Status</span>
                    <select
                      value={draft.status}
                      disabled={!canManageRow}
                      onChange={(event) => setDraft(member, { status: event.target.value as Member["status"] })}
                      style={{ padding: 8, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                      <option value="REMOVED">Removed</option>
                    </select>
                  </label>
                  {canManageRow && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={saving === member.user_id || (draft.role === member.role && draft.status === member.status)}
                      onClick={() => updateMember(member)}
                    >
                      {saving === member.user_id ? "Saving…" : "Save"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Invitations ({invitations.length})</h3>
        {invitations.length === 0 ? (
          <p className="muted">No invitations have been created.</p>
        ) : (
          <div className="stack">
            {invitations.map((invitation) => {
              const status = invitation.effectiveStatus ?? invitation.status;
              const canRevoke = status === "PENDING" && (isOwner || invitation.role !== "ADMIN");
              return (
                <article className="membership" key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <p className="muted">{invitation.role.replaceAll("_", " ")} · {status}</p>
                    <p className="muted">Expires {new Date(invitation.expires_at).toLocaleString()}</p>
                  </div>
                  {canRevoke && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={revoking === invitation.id}
                      onClick={() => revokeInvitation(invitation)}
                    >
                      {revoking === invitation.id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
