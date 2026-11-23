"use client";

import { useState } from "react";

type ImportResult = {
  imported?: number;
  pendingEligibilityReview?: number;
  message?: string;
  error?: string;
};

export function VoterRegisterImport({ processId, canEdit }: { processId: string; canEdit: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function importFile() {
    if (!file || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/processes/${processId}/voter-register/import`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      });
      const payload = (await response.json()) as ImportResult;
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");
      setResult(payload);
      setFile(null);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Import failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 20 }}>
      <p className="eyebrow">Voter register</p>
      <h3 style={{ fontSize: 20, margin: "6px 0" }}>Import voters from CSV</h3>
      <p className="muted">
        Upload a CSV with a required <code>name</code> column and optional <code>external_reference</code>, <code>email</code> and <code>phone</code> columns.
        Each upload is limited to 500 voters and 1 MB. All imported records start as PENDING and require eligibility review.
      </p>
      {canEdit ? (
        <>
          <label htmlFor="voter-register-csv" className="muted" style={{ display: "block", margin: "12px 0 6px" }}>CSV file</label>
          <input
            id="voter-register-csv"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
          <div style={{ marginTop: 12 }}>
            <button className="button" type="button" disabled={!file || busy} onClick={importFile}>
              {busy ? "Importing…" : "Import CSV"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">You need organization-level OWNER, ADMIN or ELECTION_MANAGER access to import voter records.</p>
      )}
      {result?.error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{result.error}</p>}
      {result?.message && (
        <p role="status" style={{ marginTop: 12 }}>
          {result.message} Imported: {result.imported}. Pending review: {result.pendingEligibilityReview}.
        </p>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Example header: <code>name,external_reference,email,phone</code>. Do not include passwords, ballot choices or other sensitive fields.
      </p>
    </div>
  );
}
