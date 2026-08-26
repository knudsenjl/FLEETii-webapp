// Loose client-side format checks shared by every form field that needs
// them (UserDetailsPage's e-mail/telefon, NewVehiclePage's kontaktnummer).
// These only need to catch obvious typos — the real validation for emails
// happens when Supabase Auth actually sends an invite to the address.

/** Matches "something@something.something" — good enough to catch typos, not full RFC 5322 validation. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches an optional leading "+" followed by at least 8 digits — no `\s` in the character class (a whitespace-only string like "        " would otherwise satisfy the old `[0-9\s]{8,}`, since spaces alone counted toward the 8-character minimum). Callers must test this against a whitespace-STRIPPED value (see stripNumberSpacing), not a merely-trimmed one — the field itself is still free to be typed/pasted with spaces ("70 60 86 89" for a Danish number, "+45 70 60 86 89" international), that's fine and expected; this pattern only ever sees the cleaned-up form. */
export const PHONE_PATTERN = /^\+?[0-9]{8,}$/;
