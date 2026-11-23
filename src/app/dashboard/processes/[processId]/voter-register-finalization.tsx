"use client";

import { useCallback, useEffect, useState } from "react";

type Approval = {
  approver_user_id: string;
  decision: "APPROVE" | "REJECT";
  comment: string | null;
  decided_at: string;
};

type Snapshot = {
  id: string;
  version: number;
  status: string;
  requested_by: string;
  assurance_tier: string;
  required_approvals: number;
  register_revision: number;
  total_entry_count: number;
  eligible_count: number;
  rejected_count: number;
  revoked_count: number;
  integrity_digest: string;
  created_at: string;
  finalized_at: string | null;
  resolved_at: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  approvals: Approval[];
};

type Props = {
  processId: string;
  currentUserId: string;
  processStatus: string;
  canManage: boolean;
  canGovern: boolean;
};

export function VoterRegisterFinalization({
  processId,
  currentUserId,
  processStatus,
  canManage,
  canGovern,
}: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [reason, setReason] = useState("The voter register has been reviewed and is ready for independent approval.");
  const [reopenReasons, setReopenReasons] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/processes/${processId}/voter-register/finalization`,
        { cache: "no-store" },
      );
      const payload = await response.json() as { snapshots?: Snapshot[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load finalization history.");
      setSnapshots(payload.snapshots ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load finalization history.");
    } finally {
      setLoading(false);
    }
  }, [processId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => { active = false; };
  }, [load]);

  async function requestFinalization() {
    if (!canManage || processStatus !== "DRAFT" || busyAction || reason.trim().length < 10) return;
    setBusyAction("request");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/processes/${processId}/voter-register/finalization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to request finalization.");
      setNotice("A versioned register snapshot has been submitted for independent approval.");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to request finalization.");
    } finally {
      setBusyAction(null);
    }
  }

  async function decide(snapshotId: string, decision: "APPROVE" | "REJECT") {
    if (!canGovern || busyAction) return;
    const action = `decision:${snapshotId}`;
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/processes/${processId}/voter-register/finalization/${snapshotId}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, comment: comments[snapshotId] ?? "" }),
        },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to record approval.");
      setNotice(decision === "APPROVE" ? "Independent approval recorded." : "Finalization request rejected.");
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Unable to record approval.");
    } finally {
      setBusyAction(null);
    }
  }

  async function reopen(snapshotId: string) {
    const reopenReason = (reopenReasons[snapshotId] ?? "").trim();
    if (!canGovern || processStatus !== "DRAFT" || busyAction || reopenReason.length < 10) return;
    const action = `reopen:${snapshotId}`;
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/processes/${processId}/voter-register/finalization/${snapshotId}/reopen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reopenReason }),
        },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to reopen the register.");
      setNotice("The finalized snapshot remains in history and the register is open for a new version.");
      setReopenReasons((current) => ({ ...current, [snapshotId]: "" }));
      await load();
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : "Unable to reopen the register.");
    } finally {
      setBusyAction(null);
    }
  }

  const activeSnapshot = snapshots.find((snapshot) =>
    snapshot.status === "PENDING_APPROVAL" || snapshot.status === "FINALIZED"
  );

  return (
    <section style={{ marginTop: 24, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <p className="eyebrow">Register governance</p>
          <h3 style={{ fontSize: 20, margin: "6px 0" }}>Finalization and version history</h3>
          <p className="muted">Freeze an eligibility-reviewed register, verify its integrity digest and collect independent approvals.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()} disabled={loading || Boolean(busyAction)}>
          Refresh history
        </button>
      </div>

      {error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}

      {canManage && processStatus === "DRAFT" && !activeSnapshot && (
        <div className="membership" style={{ display: "block", marginTop: 16 }}>
          <strong>Request register finalization</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            All pending eligibility reviews must be resolved, at least one voter must be eligible, and eligible external references must be unique.
            Scoped managers also need an active PII grant covering the identity categories present in the register.
          </p>
          <label htmlFor="register-finalization-reason" className="muted" style={{ display: "block", margin: "12px 0 6px" }}>Reason for finalization</label>
          <textarea
            id="register-finalization-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={1000}
            style={{ width: "100%", maxWidth: 720, padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
          />
          <button className="button" type="button" onClick={() => void requestFinalization()} disabled={Boolean(busyAction) || reason.trim().length < 10} style={{ marginTop: 10 }}>
            {busyAction === "request" ? "Submitting…" : "Submit for independent approval"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ marginTop: 16 }}>Loading register versions…</p>
      ) : snapshots.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>No register snapshots have been submitted.</p>
      ) : (
        <div className="stack" style={{ marginTop: 16 }}>
          {snapshots.map((snapshot) => {
            const approvalCount = snapshot.approvals.filter((approval) => approval.decision === "APPROVE").length;
            const rejected = snapshot.approvals.some((approval) => approval.decision === "REJECT");
            const canApprove = canGovern && snapshot.status === "PENDING_APPROVAL" &&
              snapshot.requested_by !== currentUserId && !snapshot.approvals.some((approval) => approval.approver_user_id === currentUserId);
            const canReopen = canGovern && processStatus === "DRAFT" && snapshot.status === "FINALIZED";

            return (
              <article className="membership" key={snapshot.id} style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong>Version {snapshot.version} · {snapshot.status.replaceAll("_", " ")}</strong>
                    <p className="muted">Requested {new Date(snapshot.created_at).toLocaleString()} · {snapshot.assurance_tier} assurance</p>
                  </div>
                  <p className="muted">{approvalCount}/{snapshot.required_approvals} approvals{rejected ? " · Rejected" : ""}</p>
                </div>

                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
                  <span className="muted">Total entries: <strong>{snapshot.total_entry_count}</strong></span>
                  <span className="muted">Eligible: <strong>{snapshot.eligible_count}</strong></span>
                  <span className="muted">Rejected: <strong>{snapshot.rejected_count}</strong></span>
                  <span className="muted">Revoked: <strong>{snapshot.revoked_count}</strong></span>
                  <span className="muted">Revision: <strong>{snapshot.register_revision}</strong></span>
                </div>

                <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>SHA-256 integrity digest</p>
                <code style={{ display: "block", overflowWrap: "anywhere", fontSize: 12 }}>{snapshot.integrity_digest}</code>

                {canGovern && snapshot.approvals.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: 14 }}>Approval history</strong>
                    {snapshot.approvals.map((approval) => (
                      <p className="muted" key={approval.approver_user_id} style={{ marginTop: 4 }}>
                        {approval.decision} · {approval.approver_user_id} · {new Date(approval.decided_at).toLocaleString()}
                        {approval.comment ? ` · ${approval.comment}` : ""}
                      </p>
                    ))}
                  </div>
                )}

                {canApprove && (
                  <div style={{ marginTop: 14 }}>
                    <label className="muted" htmlFor={`snapshot-comment-${snapshot.id}`}>Approval comment (optional)</label>
                    <textarea
                      id={`snapshot-comment-${snapshot.id}`}
                      value={comments[snapshot.id] ?? ""}
                      onChange={(event) => setComments((current) => ({ ...current, [snapshot.id]: event.target.value }))}
                      rows={2}
                      maxLength={1000}
                      style={{ width: "100%", maxWidth: 720, padding: 8, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8, display: "block", marginTop: 6 }}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <button className="button" type="button" disabled={Boolean(busyAction)} onClick={() => void decide(snapshot.id, "APPROVE")}>
                        {busyAction === `decision:${snapshot.id}` ? "Saving…" : "Approve snapshot"}
                      </button>
                      <button className="button secondary" type="button" disabled={Boolean(busyAction)} onClick={() => void decide(snapshot.id, "REJECT")}>
                        Reject snapshot
                      </button>
                    </div>
                  </div>
                )}

                {canReopen && (
                  <div style={{ marginTop: 14, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 12 }}>
                    <strong style={{ fontSize: 14 }}>Reopen finalized register</strong>
                    <p className="muted">This preserves version {snapshot.version} and allows a corrected register to be submitted as a new version.</p>
                    <label className="muted" htmlFor={`snapshot-reopen-${snapshot.id}`}>Reopening reason</label>
                    <textarea
                      id={`snapshot-reopen-${snapshot.id}`}
                      value={reopenReasons[snapshot.id] ?? ""}
                      onChange={(event) => setReopenReasons((current) => ({ ...current, [snapshot.id]: event.target.value }))}
                      rows={2}
                      maxLength={1000}
                      style={{ width: "100%", maxWidth: 720, padding: 8, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8, display: "block", marginTop: 6 }}
                    />
                    <button className="button secondary" type="button" disabled={Boolean(busyAction) || (reopenReasons[snapshot.id] ?? "").trim().length < 10} onClick={() => void reopen(snapshot.id)} style={{ marginTop: 8 }}>
                      {busyAction === `reopen:${snapshot.id}` ? "Reopening…" : "Reopen register"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
