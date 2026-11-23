"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Approval = {
  decision: string;
  comment: string | null;
  decided_at: string;
};

type WorkflowRequest = {
  id: string;
  action: string;
  status: string;
  reason: string;
  required_approvals: number;
  requested_at: string;
  approvals: Approval[];
};

type Props = {
  processId: string;
  processStatus: string;
  canGovern: boolean;
  requests: WorkflowRequest[];
};

const actionLabels: Record<string, string> = {
  APPROVE_PROCESS: "Process approval",
  RESUME_PROCESS: "Process resumption",
  TERMINATE_PROCESS: "Process termination",
};

export function ProcessLifecycleControls({ processId, processStatus, canGovern, requests }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [reviewOutcome, setReviewOutcome] = useState("");
  const [correctiveActions, setCorrectiveActions] = useState("");
  const [decisionComment, setDecisionComment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function runAction(action: string) {
    setError("");
    setNotice("");
    if (action !== "submit_for_approval" && reason.trim().length < 10) {
      setError("Provide a reason of at least 10 characters.");
      return;
    }
    if (action === "request_resumption" && reviewOutcome.trim().length < 10) {
      setError("Document the review outcome before requesting resumption.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/processes/${processId}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: reason.trim(),
          reviewOutcome: reviewOutcome.trim(),
          correctiveActions: correctiveActions.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The workflow action could not be completed.");
        return;
      }
      setReason("");
      setReviewOutcome("");
      setCorrectiveActions("");
      setNotice(action === "submit_for_approval"
        ? "The process was submitted for approval."
        : action === "emergency_suspend"
          ? "The process suspension was recorded."
          : action === "request_resumption"
            ? "The resumption request was submitted."
            : "The termination request was submitted.");
      router.refresh();
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(requestId: string, decision: "APPROVE" | "REJECT") {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const response = await fetch(`/api/process-workflow-requests/${requestId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: decisionComment.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "The decision could not be recorded.");
        return;
      }
      setDecisionComment("");
      setNotice(decision === "APPROVE" ? "Approval recorded." : "Rejection recorded.");
      router.refresh();
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = {
    width: "100%", padding: "11px 13px", border: "1px solid #d1d5db",
    borderRadius: 8, background: "white", color: "#172033",
  } as const;

  if (!canGovern) {
    return <p className="muted">Lifecycle actions and approval decisions are restricted to organization owners and administrators.</p>;
  }

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {processStatus === "DRAFT" ? (
          <button className="button" type="button" disabled={busy} onClick={() => runAction("submit_for_approval")}>Submit for approval</button>
        ) : null}
        {processStatus === "OPEN" || processStatus === "SCHEDULED" ? (
          <button className="button secondary" type="button" disabled={busy} onClick={() => runAction("emergency_suspend")}>Emergency suspend</button>
        ) : null}
        {processStatus === "SUSPENDED" ? (
          <button className="button" type="button" disabled={busy} onClick={() => runAction("request_resumption")}>Request resumption</button>
        ) : null}
        {!["TERMINATED", "CERTIFIED"].includes(processStatus) ? (
          <button className="button secondary" type="button" disabled={busy} onClick={() => runAction("request_termination")}>Request termination</button>
        ) : null}
      </div>

      {processStatus !== "DRAFT" || processStatus === "SUSPENDED" ? (
        <label style={{ display: "grid", gap: 6 }}>
          <span>Reason for the selected action</span>
          <textarea rows={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} style={fieldStyle} placeholder="Explain why this action is necessary." />
        </label>
      ) : null}
      {processStatus === "SUSPENDED" ? (
        <>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Review outcome</span>
            <textarea rows={3} maxLength={2000} value={reviewOutcome} onChange={(e) => setReviewOutcome(e.target.value)} style={fieldStyle} placeholder="Describe the investigation and its outcome." />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Corrective actions completed (one per line)</span>
            <textarea rows={3} maxLength={4000} value={correctiveActions} onChange={(e) => setCorrectiveActions(e.target.value)} style={fieldStyle} placeholder={"Reconciled voter register\nReplaced compromised credentials"} />
          </label>
        </>
      ) : null}

      {requests.length > 0 ? (
        <section style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
          <h3 style={{ margin: "0 0 12px" }}>Governance requests</h3>
          <div className="stack">
            {requests.map((request) => (
              <article key={request.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <strong>{actionLabels[request.action] ?? request.action.replaceAll("_", " ")}</strong>
                  <span className="muted">{request.status} · {request.approvals.length}/{request.required_approvals} approvals</span>
                </div>
                <p className="muted">{request.reason}</p>
                <p className="muted">Requested {new Date(request.requested_at).toLocaleString()}</p>
                {request.approvals.length > 0 ? (
                  <ul className="muted">
                    {request.approvals.map((approval, index) => (
                      <li key={index}>{approval.decision}{approval.comment ? ` — ${approval.comment}` : ""}</li>
                    ))}
                  </ul>
                ) : null}
                {request.status === "PENDING" ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                    <button className="button" type="button" disabled={busy} onClick={() => decide(request.id, "APPROVE")}>Approve</button>
                    <button className="button secondary" type="button" disabled={busy} onClick={() => decide(request.id, "REJECT")}>Reject</button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          {requests.some((request) => request.status === "PENDING") ? (
            <label style={{ display: "grid", gap: 6, marginTop: 14 }}>
              <span>Decision comment (optional)</span>
              <textarea rows={2} maxLength={2000} value={decisionComment} onChange={(e) => setDecisionComment(e.target.value)} style={fieldStyle} />
            </label>
          ) : null}
        </section>
      ) : <p className="muted">No governance requests have been recorded for this process.</p>}

      {error ? <p role="alert" style={{ color: "#b42318" }}>{error}</p> : null}
      {notice ? <p role="status" style={{ color: "#166534" }}>{notice}</p> : null}
    </div>
  );
}
