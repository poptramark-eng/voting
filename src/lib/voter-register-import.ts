export type ImportedVoter = {
  external_reference: string | null;
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
};

export type CsvImportResult =
  | { ok: true; rows: ImportedVoter[] }
  | { ok: false; error: string };

const MAX_ROWS = 500;
const MAX_CELL_LENGTH = 500;

function parseCsvRecords(source: string): string[][] | null {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) records.push(row);
      row = [];
      cell = "";
    } else if (char === '"') {
      return null;
    } else {
      cell += char;
    }

    if (cell.length > MAX_CELL_LENGTH) return null;
  }

  if (quoted) return null;
  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) records.push(row);
  return records;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseVoterRegisterCsv(source: string): CsvImportResult {
  if (source.length === 0) return { ok: false, error: "The CSV file is empty." };
  if (source.length > 1_000_000) return { ok: false, error: "The CSV file exceeds the 1 MB limit." };

  const records = parseCsvRecords(source.replace(/^\uFEFF/, ""));
  if (!records || records.length < 2) {
    return { ok: false, error: "The CSV must contain a header and at least one valid voter row." };
  }
  if (records.length - 1 > MAX_ROWS) {
    return { ok: false, error: `A single import can contain at most ${MAX_ROWS} voters.` };
  }

  const headers = records[0].map(normalizeHeader);
  const allowed = new Set(["display_name", "name", "external_reference", "reference", "contact_email", "email", "contact_phone", "phone"]);
  if (headers.some((header) => !allowed.has(header))) {
    return { ok: false, error: "Unsupported CSV column. Use name, external_reference, email and phone." };
  }
  const nameIndex = headers.findIndex((header) => header === "display_name" || header === "name");
  const referenceIndex = headers.findIndex((header) => header === "external_reference" || header === "reference");
  const emailIndex = headers.findIndex((header) => header === "contact_email" || header === "email");
  const phoneIndex = headers.findIndex((header) => header === "contact_phone" || header === "phone");
  if (nameIndex < 0) {
    return { ok: false, error: "A name column is required (name or display_name)." };
  }

  const references = new Set<string>();
  const rows: ImportedVoter[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record.length !== headers.length) {
      return { ok: false, error: `Row ${index + 1} has ${record.length} columns; expected ${headers.length}.` };
    }

    const value = (column: number) => column < 0 ? "" : record[column].trim();
    const displayName = value(nameIndex);
    const reference = value(referenceIndex);
    const email = value(emailIndex).toLowerCase();
    const phone = value(phoneIndex);

    if (!displayName || displayName.length > 200) {
      return { ok: false, error: `Row ${index + 1} must have a name between 1 and 200 characters.` };
    }
    if (reference.length > 200 || email.length > 254 || phone.length > 40) {
      return { ok: false, error: `Row ${index + 1} contains a field that is too long.` };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: `Row ${index + 1} contains an invalid email address.` };
    }
    if (reference) {
      const normalized = reference.toLowerCase();
      if (references.has(normalized)) {
        return { ok: false, error: `Duplicate external reference found on row ${index + 1}.` };
      }
      references.add(normalized);
    }

    rows.push({
      external_reference: reference || null,
      display_name: displayName,
      contact_email: email || null,
      contact_phone: phone || null,
    });
  }

  return { ok: true, rows };
}
