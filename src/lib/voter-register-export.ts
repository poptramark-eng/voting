export const MAX_VOTER_REGISTER_PAGE_SIZE = 4999;
export const DEFAULT_VOTER_REGISTER_PAGE_SIZE = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVoterRegisterPagination(
  limitValue: string | null,
  offsetValue: string | null,
) {
  const limit = limitValue === null ? DEFAULT_VOTER_REGISTER_PAGE_SIZE : Number(limitValue);
  const offset = offsetValue === null ? 0 : Number(offsetValue);

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_VOTER_REGISTER_PAGE_SIZE ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 1_000_000
  ) {
    return null;
  }

  return { limit, offset };
}

export function parseVoterRegisterExportPagination(limit: unknown, offset: unknown) {
  const resolvedLimit = limit === undefined ? MAX_VOTER_REGISTER_PAGE_SIZE : limit;
  const resolvedOffset = offset === undefined ? 0 : offset;

  if (
    typeof resolvedLimit !== "number" ||
    !Number.isSafeInteger(resolvedLimit) ||
    resolvedLimit < 1 ||
    resolvedLimit > MAX_VOTER_REGISTER_PAGE_SIZE ||
    typeof resolvedOffset !== "number" ||
    !Number.isSafeInteger(resolvedOffset) ||
    resolvedOffset < 0 ||
    resolvedOffset > 1_000_000
  ) {
    return null;
  }

  return { limit: resolvedLimit, offset: resolvedOffset };
}

/** The RPC is queried with limit + 1 (at most 5000) to avoid false-positive hasMore flags. */
export function splitLookaheadRows(data: unknown, limit: number) {
  const fetchedRows = Array.isArray(data) ? data.filter(isRecord) : [];
  return {
    rows: fetchedRows.slice(0, limit),
    hasMore: fetchedRows.length > limit,
  };
}

export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  if (/^[\\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\\r\\n");
}
