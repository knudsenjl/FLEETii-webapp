import { useAuth } from "../contexts/AuthContext";

/**
 * The viewer's own current department name for display in prose (e.g.
 * "Reservation i {name}") — the real department name, or "alle afdelinger"
 * while the header's own Afdeling "Alle" override is active
 * (afdelingScopedToAllGrants — see AuthContext.tsx's own doc comment; a
 * regular user is never sysadm, so `afdeling` itself always stays a real,
 * non-null name even while this override is on). Lowercase "alle" since
 * this is meant to sit mid-sentence — "Reservation i alle afdelinger", not
 * "Reservation i Alle afdelinger" (PageHeader.tsx's own standalone "Alle
 * afdelinger" label capitalizes it, a different context). Shared by
 * BookingPage.tsx/BookingsPage.tsx, whose own copies of this exact
 * expression used to drift independently.
 */
export function useScopeDisplayName(): string {
  const { afdeling, afdelingScopedToAllGrants } = useAuth();
  return afdelingScopedToAllGrants ? "alle afdelinger" : (afdeling ?? "—");
}
