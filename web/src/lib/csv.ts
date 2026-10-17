/**
 * CSV, from rows a panel already has in hand.
 *
 * No endpoint and no server round trip: every chart here is drawn from an
 * aggregated array the browser already holds, so the export is that same array
 * written out. RFC 4180 quoting, because a word or a URL can contain a comma.
 */

export type CsvValue = string | number | null | undefined;
export type CsvRow = CsvValue[];

function field(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvRow[]): string {
  return rows.map((row) => row.map(field).join(",")).join("\r\n");
}

/** "Words that lift" → `words-that-lift.csv`. */
export function csvFilename(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "export"}.csv`;
}

/**
 * Hand the rows to the browser as a download, and say how many data rows were
 * written (the header is not one of them).
 */
export function downloadCsv(name: string, rows: CsvRow[]): number {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = csvFilename(name);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return Math.max(0, rows.length - 1);
}
