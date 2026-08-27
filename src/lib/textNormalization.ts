// Shared whitespace normalization for phone numbers, CVR numbers, and
// number plates specifically — NOT general free text (names, addresses,
// notes, etc. keep whatever spacing they're given). Imported directly by
// both React pages and Netlify Functions (see requestValidation.ts's own
// "Node16-ESM .js specifier" note for why functions import this the same
// way).

/**
 * Trims leading/trailing whitespace and collapses any run of internal
 * whitespace down to a single space — so "  12  34   56 78 " or
 * " AB  12  345" is stored as "12 34 56 78" / "AB 12 345" rather than
 * whatever incidental spacing it arrived with (pasted from a spreadsheet,
 * typed with a stray double-space, etc.). Use this at the point a value is
 * actually SAVED (DB insert/update) — the stored/displayed form is allowed
 * to keep a single space between groups, same as how a person would
 * normally write these out.
 */
export function normalizeNumberSpacing(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Removes ALL whitespace (leading, trailing, and internal) — so
 * "  12 34 56 78 " or " AB 12 345" becomes "12345678" / "AB12345". Use this
 * — not normalizeNumberSpacing — when a value is passed on to an external
 * service that expects the plain digit/plate string, not a formatted one
 * (cvrapi.dk, MotorAPI) or format-validated against a fixed digit count
 * (e.g. an 8-digit CVR check) — never at the point of saving/displaying a
 * value, where normalizeNumberSpacing's single-space form is what's
 * actually wanted. NOT used for PHONE_PATTERN (see its own comment) — that
 * pattern validates spaces/dashes/parens as part of the format itself, so
 * it's tested against a merely-trimmed value instead.
 */
export function stripNumberSpacing(value: string): string {
  return value.replace(/\s+/g, "");
}
