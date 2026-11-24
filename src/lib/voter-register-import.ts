export type ImportedVoter = {
  external_reference: string | null;
  display_name: string;
  contact_email: string | null;
  contact_phone: string | null;
};

export type CsvImportResult =
  | { ok: true; rows: ImportedVoter[]; ignoredColumns: string[] }
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
      if (cell.length > MAX_CELL_LENGTH) return null;
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
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
}

function findColumn(headers: string[], aliases: string[], label: string): number | null {
  const matches = headers
    .map((header, index) => aliases.includes(header) ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length > 1) {
    throw new Error("Use only one column for " + label + ".");
  }
  return matches[0] ?? null;
}

function csvCell(value: string | null): string {
  const safe = value ?? "";
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function serializeVoterRegisterCsv(rows: ImportedVoter[]): string {
  const header = ["name", "external_reference", "email", "phone"];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.display_name,
      row.external_reference,
      row.contact_email,
      row.contact_phone,
    ].map(csvCell).join(",")),
  ].join("\r\n");
}

export function parseVoterRegisterCsv(source: string): CsvImportResult {
  if (source.length === 0) return { ok: false, error: "The CSV file is empty." };
  if (source.length > 1_000_000) return { ok: false, error: "The CSV file exceeds the 1 MB limit." };

  const records = parseCsvRecords(source.replace(/^\uFEFF/, ""));
  if (!records || records.length < 2) {
    return { ok: false, error: "The CSV must contain a header and at least one valid voter row." };
  }
  if (records.length - 1 > MAX_ROWS) {
    return { ok: false, error: "A single import can contain at most " + MAX_ROWS + " voters." };
  }

  const headers = records[0].map(normalizeHeader);
  if (headers.some((header) => !header)) {
    return { ok: false, error: "Every CSV column must have a header." };
  }

  const nameAliases = ["display_name", "name", "full_name", "voter_name"];
  const firstNameAliases = ["first_name", "firstname", "given_name"];
  const lastNameAliases = ["last_name", "lastname", "surname", "family_name"];
  const referenceAliases = ["external_reference", "reference", "voter_id", "voter_number", "registration_number"];
  const emailAliases = ["contact_email", "email", "email_address"];
  const phoneAliases = ["contact_phone", "phone", "phone_number", "mobile", "mobile_number", "telephone"];
  const ignoredAliases = new Set([
    "national_id", "id_number", "gender", "date_of_birth", "dob",
    "county", "constituency", "ward", "polling_station",
  ]);
  const allowed = new Set([
    ...nameAliases, ...firstNameAliases, ...lastNameAliases,
    ...referenceAliases, ...emailAliases, ...phoneAliases, ...ignoredAliases,
  ]);
  const unsupported = headers.filter((header) => !allowed.has(header));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: "Unsupported CSV column(s): " + [...new Set(unsupported)].join(", ") +
        ". Use the supported voter fields or remove unrelated columns.",
    };
  }

  let nameIndex: number | null;
  let firstNameIndex: number | null;
  let lastNameIndex: number | null;
  let referenceIndex: number | null;
  let emailIndex: number | null;
  let phoneIndex: number | null;
  try {
    nameIndex = findColumn(headers, nameAliases, "the voter name");
    firstNameIndex = findColumn(headers, firstNameAliases, "the first name");
    lastNameIndex = findColumn(headers, lastNameAliases, "the last name");
    referenceIndex = findColumn(headers, referenceAliases, "the voter reference");
    emailIndex = findColumn(headers, emailAliases, "the email address");
    phoneIndex = findColumn(headers, phoneAliases, "the phone number");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Duplicate column mapping." };
  }

  const hasSplitName = firstNameIndex !== null || lastNameIndex !== null;
  if (nameIndex === null && (firstNameIndex === null || lastNameIndex === null)) {
    return { ok: false, error: "Provide a name column, or both First Name and Last Name columns." };
  }
  if (nameIndex !== null && hasSplitName) {
    return { ok: false, error: "Use either a full name column or First Name and Last Name, not both." };
  }

  const ignoredColumns = headers.filter((header) => ignoredAliases.has(header));
  const references = new Set<string>();
  const rows: ImportedVoter[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record.length !== headers.length) {
      return { ok: false, error: "Row " + (index + 1) + " has " + record.length + " columns; expected " + headers.length + "." };
    }

    const value = (column: number | null) => column === null ? "" : record[column].trim();
    const firstName = value(firstNameIndex);
    const lastName = value(lastNameIndex);
    if (nameIndex === null && (!firstName || !lastName)) {
      return { ok: false, error: "Row " + (index + 1) + " must contain both a first name and a last name." };
    }
    const displayName = nameIndex !== null
      ? value(nameIndex)
      : [firstName, lastName].join(" ");
    const reference = value(referenceIndex);
    const email = value(emailIndex).toLowerCase();
    const phone = value(phoneIndex);

    if (!displayName || displayName.length > 200) {
      return { ok: false, error: "Row " + (index + 1) + " must have a name between 1 and 200 characters." };
    }
    if (reference.length > 200 || email.length > 254 || phone.length > 40) {
      return { ok: false, error: "Row " + (index + 1) + " contains a field that is too long." };
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: "Row " + (index + 1) + " contains an invalid email address." };
    }
    if (reference) {
      const normalized = reference.toLowerCase();
      if (references.has(normalized)) {
        return { ok: false, error: "Duplicate voter reference found on row " + (index + 1) + "." };
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

  return { ok: true, rows, ignoredColumns: [...new Set(ignoredColumns)] };
}
