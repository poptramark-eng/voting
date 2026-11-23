"use client";

import { useState } from "react";

type BallotItem = {
  id: string;
  item_type: string;
  label: string;
  description: string | null;
  display_order: number;
};

type Contest = {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
  items: BallotItem[];
};

type Props = {
  processId: string;
  initialContests: Contest[];
  canEdit: boolean;
};

const itemTypes = ["CANDIDATE", "TEAM", "GROUP", "PARTY", "PROPOSAL", "OPTION"];

export function ProcessConfiguration({ processId, initialContests, canEdit }: Props) {
  const [contests, setContests] = useState(initialContests);
  const [contestTitle, setContestTitle] = useState("");
  const [contestDescription, setContestDescription] = useState("");
  const [itemDrafts, setItemDrafts] = useState<Record<string, { label: string; itemType: string; description: string }>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createContest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/processes/${processId}/contests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: contestTitle, description: contestDescription, displayOrder: contests.length }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to create contest.");
        return;
      }
      setContests((current) => [...current, { ...payload.contest, items: [] }]);
      setContestTitle("");
      setContestDescription("");
    } catch {
      setError("A network error occurred while creating the contest.");
    } finally {
      setBusy(false);
    }
  }

  async function addItem(contestId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = itemDrafts[contestId] ?? { label: "", itemType: "CANDIDATE", description: "" };
    setError("");
    setBusy(true);
    try {
      const contest = contests.find((entry) => entry.id === contestId);
      const response = await fetch(`/api/contests/${contestId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: draft.label,
          itemType: draft.itemType,
          description: draft.description,
          displayOrder: contest?.items.length ?? 0,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Unable to add ballot option.");
        return;
      }
      setContests((current) => current.map((entry) =>
        entry.id === contestId ? { ...entry, items: [...entry.items, payload.item] } : entry
      ));
      setItemDrafts((current) => ({ ...current, [contestId]: { ...draft, label: "", description: "" } }));
    } catch {
      setError("A network error occurred while adding the ballot option.");
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = {
    width: "100%", padding: "11px 13px", border: "1px solid #d1d5db",
    borderRadius: 8, background: "white", color: "#172033",
  } as const;

  return (
    <div className="stack">
      {contests.length > 0 ? contests.map((contest) => (
        <article key={contest.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: "0 0 6px" }}>{contest.title}</h3>
              {contest.description ? <p className="muted">{contest.description}</p> : null}
            </div>
            <span className="muted">{contest.items.length} options</span>
          </div>
          {contest.items.length > 0 ? (
            <div className="stack">
              {contest.items.map((item) => (
                <div className="membership" key={item.id}>
                  <div>
                    <strong>{item.label}</strong>
                    {item.description ? <p className="muted">{item.description}</p> : null}
                  </div>
                  <span className="muted">{item.item_type.replaceAll("_", " ")}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No ballot options added yet.</p>}
          {canEdit ? (
            <form className="stack" onSubmit={(event) => addItem(contest.id, event)} style={{ marginTop: 18 }}>
              <strong>Add a ballot option</strong>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Option label</span>
                <input required minLength={1} maxLength={200} value={itemDrafts[contest.id]?.label ?? ""}
                  onChange={(e) => setItemDrafts((current) => ({ ...current, [contest.id]: { label: e.target.value, itemType: current[contest.id]?.itemType ?? "CANDIDATE", description: current[contest.id]?.description ?? "" } }))} style={fieldStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Option type</span>
                <select value={itemDrafts[contest.id]?.itemType ?? "CANDIDATE"}
                  onChange={(e) => setItemDrafts((current) => ({ ...current, [contest.id]: { label: current[contest.id]?.label ?? "", itemType: e.target.value, description: current[contest.id]?.description ?? "" } }))} style={fieldStyle}>
                  {itemTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Description (optional)</span>
                <input maxLength={4000} value={itemDrafts[contest.id]?.description ?? ""}
                  onChange={(e) => setItemDrafts((current) => ({ ...current, [contest.id]: { label: current[contest.id]?.label ?? "", itemType: current[contest.id]?.itemType ?? "CANDIDATE", description: e.target.value } }))} style={fieldStyle} />
              </label>
              <div><button className="button secondary" type="submit" disabled={busy}>{busy ? "Saving…" : "Add option"}</button></div>
            </form>
          ) : null}
        </article>
      )) : <p className="muted">No contests have been added to this ballot yet.</p>}

      {canEdit ? (
        <form className="stack" onSubmit={createContest} style={{ maxWidth: 640, marginTop: 16 }}>
          <h3 style={{ marginBottom: 0 }}>Add a contest or question</h3>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Contest title</span>
            <input required minLength={1} maxLength={200} value={contestTitle} onChange={(e) => setContestTitle(e.target.value)} placeholder="e.g. Chairperson" style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Description (optional)</span>
            <textarea rows={2} maxLength={4000} value={contestDescription} onChange={(e) => setContestDescription(e.target.value)} style={fieldStyle} />
          </label>
          <div><button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Add contest"}</button></div>
        </form>
      ) : <p className="muted">You have read-only access to this ballot configuration.</p>}
      {error ? <p role="alert" style={{ color: "#b42318" }}>{error}</p> : null}
    </div>
  );
}
