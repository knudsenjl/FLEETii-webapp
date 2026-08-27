// Loose client-side format checks shared by every form field that needs
// them (UserDetailsPage's e-mail/telefon, NewVehiclePage's kontaktnummer).
// These only need to catch obvious typos — the real validation for emails
// happens when Supabase Auth actually sends an invite to the address.

/** Matches "something@something.something" — good enough to catch typos, not full RFC 5322 validation. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Loosely matches common international phone-number notations — just an
 * "is this shaped like a phone number" check, no per-country validity (no
 * libphonenumber-style numbering-plan verification): an optional leading
 * "+" + 1-3 digit country code, then one or more digit groups (each
 * optionally wrapped in parentheses, e.g. an area code) separated by spaces
 * and/or dashes, with at least 8 digits somewhere in the whole thing. Covers
 * "70608689", "+45 70 60 86 89", "(143) 234 453 22", "123-456-78",
 * "+1 (999) 123-4567", etc. Callers must test this against a merely-
 * TRIMMED value, not a whitespace-STRIPPED one (see stripNumberSpacing) —
 * unlike the old digits-only version, the spaces/dashes here are part of
 * what's being validated, not noise to discard first.
 */
export const PHONE_PATTERN = /^(?=(?:\D*\d){8,})(?:\+\d{1,3}[\s-]*)?(?:\(\d+\)|\d+)(?:[\s-]+(?:\(\d+\)|\d+))*$/;
