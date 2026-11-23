"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { organizationId: string };

export function CreateEventForm({ organizationId }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ORGANIZATIONAL_ELECTION");
  const [assuranceTier, setAssuranceTier] = useState("STANDARD");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch(`/api/organizations/${organizationId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, category, assuranceTier }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to create the event.");
        return;
      }
      setTitle("");
      setDescription("");
      router.refresh();
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldStyle = {
    width: "100%",
    padding: "12px 14px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    background: "white",
    color: "#172033",
  } as const;

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 640 }}>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Event title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} minLength={2} maxLength={200} required placeholder="e.g. Student Council Elections" style={fieldStyle} />
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Description <span className="muted">(optional)</span></span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} style={fieldStyle} />
      </label>
      <label style={{ display: "grid", gap: 8 }}>
        <span>Event category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={fieldStyle}>
          <option value="GENERAL_POLL">General poll</option>
          <option value="CONTEST">Contest</option>
          <option value="ORGANIZATIONAL_ELECTION">Organizational election</option>
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
      {error ? <p role="alert" style={{ color: "#b42318" }}>{error}</p> : null}
      <div>
        <button className="button" type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create event"}</button>
      </div>
    </form>
  );
}
