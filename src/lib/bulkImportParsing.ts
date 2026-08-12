// Pure CSV/JSON parsing for the bulk-import Netlify Functions
// (bulk-import-users.mts, bulk-import-vehicles.mts) — kept here rather than
// under netlify/functions/_shared so it's unit-testable with Vitest like the
// rest of src/lib, and reusable later by a browser-side upload UI (papaparse
// works in both Node and the browser).
import Papa from "papaparse";

/** One parsed row from an import file, before any field-specific validation — string values straight from CSV column headers or JSON object keys. */
export type ImportRow = Record<string, unknown>;

/**
 * Parses `content` as either CSV (header row required) or a JSON array of
 * objects, returning one plain object per row/array element. Column headers
 * and string values are trimmed; blank CSV lines are skipped. Throws a
 * plain Error with a Danish message on anything that isn't parseable into
 * that shape — malformed JSON, a JSON value that isn't an array of objects,
 * or a CSV papaparse itself flags as broken — so callers can turn it
 * straight into a 400 response.
 */
export function parseImportFile(content: string, format: "csv" | "json"): ImportRow[] {
  if (format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Ugyldig JSON-fil.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("JSON-filen skal indeholde en liste (array) af objekter.");
    }
    if (!parsed.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
      throw new Error("Hvert element i JSON-filen skal være et objekt.");
    }
    return parsed as ImportRow[];
  }

  const result = Papa.parse<ImportRow>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => (typeof value === "string" ? value.trim() : value),
  });
  if (result.errors.length > 0) {
    throw new Error(`Ugyldig CSV-fil: ${result.errors[0].message}`);
  }
  return result.data;
}
