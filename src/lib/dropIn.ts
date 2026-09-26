// Client-side shape of a drop-in reservation's guest (a walk-in visitor with
// no FLEETii account — see the drop-in reservation plan). Collected on
// DropInGuestPage.tsx and carried through router state (like `editing`)
// across ReservationPage → AvailablePage → ConfirmPage, which finally sends
// it to netlify/functions/create-drop-in-booking.mts. Never written by the
// client itself — booking_guests has no client-side write grants.

export type DropInGuest = {
  name: string;
  email: string;
  phone: string;
  address: string;
  licenseNo: string;
  /** "Kørekort og legitimation kontrolleret" — the receptionist's own confirmation; FLEETii stores no ID data. */
  idChecked: boolean;
};

/** The Anvendelse a drop-in starts with (user decision 2026-09-26); still editable on ReservationPage. */
export const DROP_IN_DEFAULT_ANVENDELSE = "Prøvekørsel";

/** How a drop-in booking is labelled where a Bruger would be: "Drop-in: ‹navn›" for admins, just "Drop-in" when the name isn't known or mustn't be shown (regular users). */
export function dropInLabel(name?: string | null): string {
  return name ? `Drop-in: ${name}` : "Drop-in";
}

/** Whether every required guest field is filled in (all five are required — user decision 2026-09-26) and the email looks like one. Mirrors create-drop-in-booking.mts's own server-side check. */
export function isDropInGuestComplete(guest: DropInGuest): boolean {
  return (
    Boolean(guest.name.trim() && guest.phone.trim() && guest.address.trim() && guest.licenseNo.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email.trim())
  );
}

/** Reads a DropInGuest out of router state, or null when this isn't a drop-in flow. */
export function readDropInGuest(state: unknown): DropInGuest | null {
  const guest = (state as { dropInGuest?: DropInGuest } | null)?.dropInGuest;
  return guest && typeof guest.name === "string" ? guest : null;
}
