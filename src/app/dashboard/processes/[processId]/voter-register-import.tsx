"use client";

import { useState } from "react";
import { parseVoterRegisterCsv, serializeVoterRegisterCsv } from "@/lib/voter-register-import";

type ImportResult = {
  imported?: number;
  pendingEligibilityReview?: number;
  message?: string;
  error?: string;
  ignoredColumns?: string[];
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
      // Normalize in the browser first. Only the four fields supported by the
      // register schema are sent to the server; national ID and other optional
      // spreadsheet columns never leave the browser.
      const parsed = parseVoterRegisterCsv(await file.text());
      if (!parsed.ok) throw new Error(parsed.error);

      const response = await fetch("/api/processes/" + processId + "/voter-register/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: serializeVoterRegisterCsv(parsed.rows),
      });
      const payload = (await response.json()) as ImportResult;
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");
      setResult({ ...payload, ignoredColumns: parsed.ignoredColumns });
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
      <h3 style={{ fontSize: 20, margin: "6px 0" }}>Import voters from Excel or CSV</h3>
      <p className="muted">
        Prepare your list in Excel, then save or export it as a CSV file (UTF-8) before uploading.
        The importer accepts either a full name column or First Name and Last Name, plus Voter ID,
        Email and Phone Number. Each upload is limited to 500 voters and 1 MB. Imported records
        start as PENDING and must pass eligibility review.
      </p>
      <p className="muted" style={{ marginTop: 8 }}>
        Data minimization: only voter reference, name, email and phone are retained. National ID,
        date of birth, gender and location columns are removed in your browser before upload and
        are not stored by this import.
      </p>
      {canEdit ? (
        <>
          <label htmlFor="voter-register-csv" className="muted" style={{ display: "block", margin: "12px 0 6px" }}>CSV file exported from Excel</label>
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
              {busy ? "Importing…" : "Validate and import"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">You need organization-level OWNER, ADMIN or ELECTION_MANAGER access to import voter records.</p>
      )}
      {result?.error && <p role="alert" style={{ color: "#b42318", marginTop: 12 }}>{result.error}</p>}
      {result?.message && (
        <div role="status" style={{ marginTop: 12 }}>
          <p>{result.message} Imported: {result.imported}. Pending review: {result.pendingEligibilityReview}.</p>
          {result.ignoredColumns && result.ignoredColumns.length > 0 && (
            <p className="muted">Not retained: {result.ignoredColumns.map((column) => column.replaceAll("_", " ")).join(", ")}.</p>
          )}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Supported spreadsheet headers include: <code>Voter ID, National ID, First Name, Last Name, Gender, Date of Birth, Phone Number, Email, County, Constituency, Ward, Polling Station</code>.
        Voter ID becomes the external reference. National ID and the other non-supported attributes are discarded.
      </p>
    </div>
  );
}
