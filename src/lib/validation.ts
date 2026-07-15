// Loose client-side format checks shared by every form field that needs
// them (UserDetailsPage's e-mail/telefon, NewVehiclePage's kontaktnummer).
// These only need to catch obvious typos — the real validation for emails
// happens when Supabase Auth actually sends an invite to the address.

/** Matches "something@something.something" — good enough to catch typos, not full RFC 5322 validation. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches an optional leading "+" followed by at least 8 digits/spaces — loose enough for Danish numbers ("70 60 86 89") and international ones ("+45 70 60 86 89"). */
export const PHONE_PATTERN = /^\+?[0-9\s]{8,}$/;
