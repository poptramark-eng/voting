"use client";

import { useCallback, useEffect, useState } from "react";

type RegisterRow = {
  id: string;
  displayName?: string;
  externalReference?: string;
  contactEmail?: string;
  contactPhone?: string;
  eligibilityStatus: "PENDING" | "ELIGIBLE" | "REJECTED" | "REVOKED";
  source: string;
  createdAt: string;
  updatedAt: string;
};

type AccessRequest = {
  id: string;
  recipient_user_id: string;
  requested_by: string;
  permitted_categories: string[];
  purpose: string;
  assurance_tier: string;
  required_approvals: number;
  status: string;
  effectiveStatus?: string;
  requested_expires_at: string;
  expires_at: string | null;
};

type Props = {
  processId: string;
  eventId: string;
  currentUserId: string;
  assuranceTier: "STANDARD" | "ENHANCED" | "HIGH" | "CRITICAL";
  canManage: boolean;
  canRequestPii: boolean;
  canGovern: boolean;
};

const PAGE_SIZE = 50;

export function VoterRegisterWorkspace({
  processId,
  eventId,
  currentUserId,
  assuranceTier,
  canManage,
  canRequestPii,
  canGovern,
}: Props) {
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [accessRequired, setAccessRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("Review voter identities and verify eligibility before the voter register is finalized.");
  const [requesting, setRequesting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const loadRows = useCallback(async (nextOffset = 0) => {
    setLoadingRows(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/processes/${processId}/voter-register?limit=${PAGE_SIZE}&offset=${nextOffset}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as {
        rows?: RegisterRow[];
        hasMore?: boolean;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 403) {
          setAccessRequired(true);
          setRows([]);
          setHasMore(false);
          setOffset(nextOffset);
          return;
        }
        throw new Error(payload.error ?? "Unable to load voter register.");
      }
      setAccessRequired(false);
      setRows(payload.rows ?? []);
      setHasMore(Boolean(payload.hasMore));
      setOffset(nextOffset);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load voter register.");
    } finally {
      setLoadingRows(false);
    }
  }, [processId]);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const response = await fetch(
        `/api/voter-pii-access-requests?processId=${processId}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as { requests?: AccessRequest[] };
      if (response.ok) setRequests(payload.requests ?? []);
    } catch {
      // Register access and request creation remain available if the request list is unavailable.
    } finally {
      setLoadingRequests(false);
    }
  }, [processId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void loadRows(0);
      void loadRequests();
    });
    return () => {
      active = false;
    };
  }, [loadRows, loadRequests]);

  async function requestPiiAccess() {
    if (!canRequestPii || requesting || purpose.trim().length < 20) return;
    setRequesting(true);
    setError(null);
    setNotice(null);
    try {
      const lifetimeHours: Record<Props["assuranceTier"], number> = {
        STANDARD: 24,
        ENHANCED: 24,
        HIGH: 12,
        CRITICAL: 2,
      };
      const expiresAt = new Date(Date.now() + lifetimeHours[assuranceTier] * 60 * 60 * 1000).toISOString();
      const response = await fetch("/api/voter-pii-access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "PROCESS",
          eventId,
          processId,
          recipientUserId: currentUserId,
          categories: ["VOTER_NAME", "EXTERNAL_REFERENCE"],
          purpose: purpose.trim(),
          expiresAt,
        }),
      });
      const payload = await response.json() as { error?: string; requestId?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to request voter PII access.");
      setNotice("Your time-limited access request was submitted for independent approval.");
      await loadRequests();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to request voter PII access.");
    } finally {
      setRequesting(false);
    }
  }

  async function decideRequest(requestId: string, decision: "APPROVE" | "REJECT") {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/voter-pii-access-requests/${requestId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to record the approval decision.");
      setNotice(decision === "APPROVE" ? "Approval decision recorded." : "Access request rejected.");
      await loadRequests();
      await loadRows(offset);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Unable to record the approval decision.");
    }
  }

  async function reviewEntry(entry: RegisterRow, status: "ELIGIBLE" | "REJECTED" | "REVOKED") {
    const reason = (reasons[entry.id] ?? "").trim();
    if (reason.length < 10 || savingId) return;
    setSavingId(entry.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/processes/${processId}/voter-register/${entry.id}/eligibility`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, reason }),
        },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update voter eligibility.");
      setNotice(`Voter eligibility changed to ${status.replaceAll("_", " ")}.`);
      setReasons((current) => ({ ...current, [entry.id]: "" }));
      await loadRows(offset);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Unable to update voter eligibility.");
    } finally {
      setSavingId(null);
    }
  }

  const pendingRequests = requests.filter((request) => (request.effectiveStatus ?? request.status) === "PENDING");

  return (
    <section style={{ marginTop: 24, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 20 }}>
      <p className="eyebrow">Voter register</p>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h3 style={{ fontSize: 20, margin: "6px 0" }}>Register and eligibility review</h3>
          <p className="muted">Review the voter list under the process&apos; access and assurance controls.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => { void loadRows(offset); void loadRequests(); }} disabled={loadingRows}>
          Refresh
        </button>
      </div>

      {error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{error}</p>}
      {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}

      {accessRequired && (
        <div className="membership" style={{ marginTop: 16, display: "block" }}>
          <strong>Voter PII access is required</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            Your scoped role does not automatically reveal voter identities. Request access for this process; an independent organization OWNER or ADMIN must approve it.
          </p>
          {canRequestPii ? (
            <>
              <label htmlFor="voter-pii-purpose" className="muted" style={{ display: "block", margin: "12px 0 6px" }}>Purpose of access</label>
              <textarea
                id="voter-pii-purpose"
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                rows={3}
                maxLength={1000}
                style={{ width: "100%", maxWidth: 720, padding: 10, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
              />
              <button className="button" type="button" onClick={requestPiiAccess} disabled={requesting || purpose.trim().length < 20} style={{ marginTop: 10 }}>
                {requesting ? "Submitting…" : "Request time-limited access"}
              </button>
            </>
          ) : (
            <p className="muted">Your current role cannot request voter-identifying data access.</p>
          )}
        </div>
      )}

      {loadingRequests && (canGovern || canRequestPii) && <p className="muted" style={{ marginTop: 12 }}>Loading access requests…</p>}

      {canGovern && pendingRequests.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h4 style={{ fontSize: 16 }}>Pending voter PII approvals</h4>
          <p className="muted">Approvals are independent and must meet the request's assurance-tier threshold.</p>
          <div className="stack">
            {pendingRequests.map((request) => (
              <article className="membership" key={request.id}>
                <div>
                  <strong>{request.permitted_categories.join(", ")}</strong>
                  <p className="muted">{request.purpose}</p>
                  <p className="muted">Tier: {request.assurance_tier} · Required approvals: {request.required_approvals}</p>
                  <p className="muted">Requested expiry: {new Date(request.requested_expires_at).toLocaleString()}</p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="button" type="button" onClick={() => decideRequest(request.id, "APPROVE")}>Approve</button>
                  <button className="button secondary" type="button" onClick={() => decideRequest(request.id, "REJECT")}>Reject</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {canRequestPii && !accessRequired && requests.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Your access request status: {requests.find((request) => request.recipient_user_id === currentUserId)?.effectiveStatus ??
            requests.find((request) => request.recipient_user_id === currentUserId)?.status ?? "No current request"}.
        </p>
      )}

      {!accessRequired && (
        <div style={{ marginTop: 20 }}>
          {loadingRows ? (
            <p className="muted">Loading voter register…</p>
          ) : rows.length === 0 ? (
            <p className="muted">No voter records are available on this page.</p>
          ) : (
            <>
              <div className="stack">
                {rows.map((entry) => (
                  <article className="membership" key={entry.id} style={{ alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong>{entry.displayName ?? "Name not permitted by grant"}</strong>
                      <p className="muted">
                        {entry.externalReference ? `Reference: ${entry.externalReference} · ` : ""}
                        {entry.contactEmail ?? ""}
                        {entry.contactPhone ? ` · ${entry.contactPhone}` : ""}
                      </p>
                      <p className="muted">Status: {entry.eligibilityStatus} · Source: {entry.source.replaceAll("_", " ")}</p>
                    </div>
                    {canManage && entry.eligibilityStatus !== "REJECTED" && entry.eligibilityStatus !== "REVOKED" && (
                      <div style={{ width: "min(100%, 360px)" }}>
                        <label className="muted" htmlFor={`review-reason-${entry.id}`}>Review reason</label>
                        <textarea
                          id={`review-reason-${entry.id}`}
                          value={reasons[entry.id] ?? ""}
                          onChange={(event) => setReasons((current) => ({ ...current, [entry.id]: event.target.value }))}
                          rows={2}
                          maxLength={1000}
                          placeholder="Explain the eligibility decision (at least 10 characters)."
                          style={{ width: "100%", padding: 8, border: "1px solid var(--border, #d0d5dd)", borderRadius: 8 }}
                        />
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                          {entry.eligibilityStatus === "PENDING" && (
                            <>
                              <button className="button" type="button" disabled={savingId === entry.id || (reasons[entry.id] ?? "").trim().length < 10} onClick={() => reviewEntry(entry, "ELIGIBLE")}>
                                Mark eligible
                              </button>
                              <button className="button secondary" type="button" disabled={savingId === entry.id || (reasons[entry.id] ?? "").trim().length < 10} onClick={() => reviewEntry(entry, "REJECTED")}>
                                Reject
                              </button>
                            </>
                          )}
                          {entry.eligibilityStatus === "ELIGIBLE" && (
                            <button className="button secondary" type="button" disabled={savingId === entry.id || (reasons[entry.id] ?? "").trim().length < 10} onClick={() => reviewEntry(entry, "REVOKED")}>
                              Revoke eligibility
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 16 }}>
                <button className="button secondary" type="button" disabled={offset === 0 || loadingRows} onClick={() => loadRows(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
                <span className="muted">Showing {offset + 1}–{offset + rows.length}</span>
                <button className="button secondary" type="button" disabled={!hasMore || loadingRows} onClick={() => loadRows(offset + PAGE_SIZE)}>Next</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
