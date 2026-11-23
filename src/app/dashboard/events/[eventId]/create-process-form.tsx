"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { eventId: string };

export function CreateProcessForm({ eventId }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [ballotFormat, setBallotFormat] = useState("SINGLE_CHOICE");
  const [eligibilityMode, setEligibilityMode] = useState("MANAGED_REGISTER");
  const [assuranceTier, setAssuranceTier] = useState("STANDARD");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!opensAt || !closesAt || new Date(closesAt) <= new Date(opensAt)) {
      setError("Choose a valid opening and closing time. Closing must be after opening.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/events/${eventId}/processes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, ballotFormat, eligibilityMode, assuranceTier,
          opensAt: new Date(opensAt).toISOString(),
          closesAt: new Date(closesAt).toISOString(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to create the process.");
        return;
      }
      setTitle("");
      router.refresh();
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldStyle = {
    width: "100%", padding: "12px 14px", border: "1px solid #d1d5db",
    borderRadius: 8, background: "white", color: "#172033",
  } as const;

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 640 }}>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Process title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} minLength={2} maxLength={200} required placeholder="e.g. Chairperson Election" style={fieldStyle} />
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Ballot format</span>
        <select value={ballotFormat} onChange={(e) => setBallotFormat(e.target.value)} style={fieldStyle}>
          <option value="SINGLE_CHOICE">Single choice</option>
          <option value="MULTIPLE_CHOICE">Multiple choice</option>
          <option value="RANKED_CHOICE">Ranked choice</option>
          <option value="YES_NO">Yes / No</option>
          <option value="APPROVAL">Approval</option>
          <option value="SCORED">Scored</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Voter eligibility</span>
        <select value={eligibilityMode} onChange={(e) => setEligibilityMode(e.target.value)} style={fieldStyle}>
          <option value="MANAGED_REGISTER">Managed voter register</option>
          <option value="INVITATION_ONLY">Invitation only</option>
          <option value="OPEN_LINK">Open link</option>
          <option value="VERIFIED_MEMBERSHIP">Verified membership</option>
          <option value="COMBINED">Combined rules</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Assurance tier</span>
        <select value={assuranceTier} onChange={(e) => setAssuranceTier(e.target.value)} style={fieldStyle}>
          <option value="STANDARD">Standard</option>
          <option value="ENHANCED">Enhanced</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Opens at</span>
        <input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} required style={fieldStyle} />
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Closes at</span>
        <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} required style={fieldStyle} />
      </label>
      {error ? <p role="alert" style={{ color: "#b42318" }}>{error}</p> : null}
      <div><button className="button" type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create process"}</button></div>
    </form>
  );
}
