// The "Gæst" panel on BookingDetailsPage.tsx for a drop-in booking (admin/
// sysadm only): the walk-in guest's details plus the receptionist's two
// controls for the guest's emailed link — "Send email igen" (a fresh link;
// the old one stops working) and "Tilbagekald adgang" (the link stops working
// now, permanently). Both go through guest-access-admin.mts; the details
// themselves are read straight from booking_guests, whose RLS only returns
// the row to admins of the vehicle's costumer and sysadm (token_hash isn't
// even column-granted, so it can't be selected here).
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { formatDanishDateTime } from "../lib/time";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldList } from "./FieldList";
import { FieldRow } from "./FieldRow";
import { SectionHeading } from "./SectionHeading";

type GuestRow = {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  license_no: string | null;
  id_checked: boolean;
  revoked_at: string | null;
  anonymized_at: string | null;
  created_at: string;
  user_profiles: { full_name: string | null; email: string | null } | null;
};

interface DropInGuestPanelProps {
  bookingId: string;
  /** The booking's end (UTC ISO) — once the link window is over, "Send email igen" is pointless and hidden. */
  endIso: string | null;
  /** Set when ConfirmPage just created this drop-in but the guest's email failed to send (see create-drop-in-booking.mts) — shown as a warning pointing at "Send email igen". */
  emailFailed?: boolean;
}

/** guest-access-admin.mts's link window tail (end + 30 min) — mirrored here only to decide whether "Send email igen" is still worth offering; the server re-checks. */
const LINK_TAIL_MS = 30 * 60_000;

export function DropInGuestPanel({ bookingId, endIso, emailFailed = false }: DropInGuestPanelProps) {
  const { session } = useAuth();
  const [guest, setGuest] = useState<GuestRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(
    emailFailed ? { text: "Reservationen er oprettet, men emailen til gæsten kunne ikke sendes. Prøv \"Send email igen\".", error: true } : null,
  );
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("booking_guests")
      .select("name, email, phone, address, license_no, id_checked, revoked_at, anonymized_at, created_at, user_profiles(full_name, email)")
      .eq("booking_id", bookingId)
      .maybeSingle<GuestRow>();
    if (error) setLoadError(error.message);
    else setGuest(data);
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "resend" | "revoke") => {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/.netlify/functions/guest-access-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ bookingId, action }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage({ text: result.error ?? "Der opstod en fejl.", error: true });
      } else {
        setMessage({
          text: action === "resend" ? "En ny email med et nyt link er sendt. Det gamle link virker ikke længere." : "Adgangen er tilbagekaldt.",
          error: false,
        });
        await load();
      }
    } catch {
      setMessage({ text: "Kunne ikke kontakte serveren. Prøv igen.", error: true });
    } finally {
      setBusy(null);
      setConfirmRevoke(false);
    }
  };

  if (loadError) return <p className="text-sm text-red-600">Kunne ikke hente gæstens oplysninger: {loadError}</p>;
  if (!guest) return null;

  const linkOver = endIso !== null && Date.now() > Date.parse(endIso) + LINK_TAIL_MS;
  const status = guest.anonymized_at
    ? "Anonymiseret"
    : guest.revoked_at
      ? `Tilbagekaldt ${formatDanishDateTime(guest.revoked_at)}`
      : linkOver
        ? "Udløbet"
        : "Aktiv";
  const canAct = !guest.anonymized_at && !guest.revoked_at && !linkOver;
  const createdBy = guest.user_profiles?.full_name?.trim() || guest.user_profiles?.email || "—";

  const rows: [string, string][] = [
    ["Navn:", guest.name ?? "—"],
    ["Email:", guest.email ?? "—"],
    ["Telefon:", guest.phone ?? "—"],
    ["Adresse:", guest.address ?? "—"],
    ["Kørekort-nr.:", guest.license_no ?? "—"],
    ["Legitimation:", guest.id_checked ? "Kontrolleret" : "Ikke kontrolleret"],
    ["Oprettet af:", `${createdBy} (${formatDanishDateTime(guest.created_at)})`],
    ["Gæstens link:", status],
  ];

  return (
    <div className="flex flex-col gap-2">
      <SectionHeading className="shrink-0">Gæst</SectionHeading>
      <FieldList>
        {rows.map(([label, value]) => (
          <FieldRow key={label} label={label}>
            <span className="text-sm text-brand-800">{value}</span>
          </FieldRow>
        ))}
      </FieldList>

      {canAct && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" type="button" onClick={() => void act("resend")} disabled={busy !== null} className="w-full">
            {busy === "resend" ? "Sender…" : "Send email igen"}
          </Button>
          <Button variant="danger" type="button" onClick={() => setConfirmRevoke(true)} disabled={busy !== null} className="w-full">
            Tilbagekald adgang
          </Button>
        </div>
      )}

      {message && <p className={`text-sm ${message.error ? "text-red-600" : "text-green-700"}`}>{message.text}</p>}

      {confirmRevoke && (
        <ConfirmDialog
          message="Gæstens link holder op med at virke med det samme, og det kan ikke genåbnes. Vil du tilbagekalde adgangen?"
          onCancel={() => setConfirmRevoke(false)}
          onConfirm={() => void act("revoke")}
          isPending={busy === "revoke"}
          confirmPendingLabel="Tilbagekalder…"
        />
      )}
    </div>
  );
}
