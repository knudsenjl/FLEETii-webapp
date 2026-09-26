import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { PageShell } from "../components/PageShell";
import { Button } from "../components/Button";
import { FieldList } from "../components/FieldList";
import { FieldRow } from "../components/FieldRow";
import { RequiredMark } from "../components/RequiredMark";
import { PageSection } from "../components/PageSection";
import { PageSectionBody } from "../components/PageSectionBody";
import { SectionHeading } from "../components/SectionHeading";
import { isDropInGuestComplete, readDropInGuest, type DropInGuest } from "../lib/dropIn";

/** The five text fields, in display order: [key, label, input type, autocomplete hint]. */
const TEXT_FIELDS: [Exclude<keyof DropInGuest, "idChecked">, string, string, string][] = [
  ["name", "Navn", "text", "off"],
  ["email", "Email", "email", "off"],
  ["phone", "Telefon", "tel", "off"],
  ["address", "Adresse", "text", "off"],
  ["licenseNo", "Kørekort-nr.", "text", "off"],
];

const EMPTY_GUEST: DropInGuest = { name: "", email: "", phone: "", address: "", licenseNo: "", idChecked: false };

/**
 * Step 1 of a drop-in reservation ("/drop-in", admin/sysadm — the
 * receptionist): "Gæstens oplysninger", the walk-in visitor's details.
 * Reached from AdminFrontpage.tsx's "Drop-in reservation" button. All five
 * fields AND the "Kørekort og legitimation kontrolleret" checkbox are
 * required — "Fortsæt" stays disabled until they're all done (user decisions
 * 2026-09-26). The checkbox is the receptionist's own record that they
 * looked at the driving licence and ID — FLEETii stores no CPR or ID data. Nothing is written here: "Fortsæt" carries the guest in router
 * state into the normal ReservationPage → AvailablePage → ConfirmPage flow
 * (drop-in mode), and only ConfirmPage's "Bekræft" creates anything, via
 * create-drop-in-booking.mts. Re-entered with the same guest pre-filled on a
 * browser back-navigation from ReservationPage (that page keeps
 * `dropInGuest` on its own history state).
 */
export function DropInGuestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [guest, setGuest] = useState<DropInGuest>(() => readDropInGuest(location.state) ?? EMPTY_GUEST);

  const update = (key: keyof DropInGuest, value: string | boolean) => setGuest((g) => ({ ...g, [key]: value }));

  const handleContinue = () => {
    const trimmed: DropInGuest = {
      name: guest.name.trim(),
      email: guest.email.trim(),
      phone: guest.phone.trim(),
      address: guest.address.trim(),
      licenseNo: guest.licenseNo.trim(),
      idChecked: guest.idChecked,
    };
    // Keep what was typed on this page's own history entry, so a browser
    // back-navigation from ReservationPage finds it again.
    navigate(location.pathname, { replace: true, state: { dropInGuest: trimmed } });
    navigate("/reservation", { state: { dropInGuest: trimmed } });
  };

  return (
    <PageShell>
      <PageHeader />

      <PageSection>
        <PageSectionBody>
          <SectionHeading>Drop-in reservation – gæstens oplysninger</SectionHeading>

          <FieldList>
            {TEXT_FIELDS.map(([key, label, type, autoComplete]) => (
              <FieldRow key={key} className="grid grid-cols-2 gap-3 p-3 sm:p-4" label={<>{label} <RequiredMark /></>}>
                <input
                  type={type}
                  required
                  aria-required="true"
                  autoComplete={autoComplete}
                  value={guest[key]}
                  onChange={(e) => update(key, e.target.value)}
                  className="rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-800 outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
                />
              </FieldRow>
            ))}
            <label className="flex cursor-pointer items-center gap-3 p-3 text-sm text-brand-700 sm:p-4">
              <input
                type="checkbox"
                checked={guest.idChecked}
                onChange={(e) => update("idChecked", e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              <span>
                Kørekort og legitimation kontrolleret <RequiredMark />
              </span>
            </label>
          </FieldList>

          <p className="text-right text-xs text-brand-500">
            <span className="text-red-600">*</span> Feltet skal udfyldes
          </p>

          {/* Highlighted, not a footnote: the receptionist should tell the guest to look for this email (same box style as GuestDrivePage.tsx's lock reminder, in brand blue since it's information, not a warning). */}
          <div
            role="note"
            className="flex items-start gap-3 rounded-2xl border-2 border-brand-400 bg-brand-100 p-4 text-sm font-semibold text-brand-800 shadow-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              Når reservationen er oprettet, vil gæsten få tilsendt en email med et link, hvor køretøjet kan låses og låses op i
              reservationens periode.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => navigate("/admin")} className="w-full">
              Fortryd
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={handleContinue}
              disabled={!isDropInGuestComplete(guest)}
              className="w-full"
            >
              Fortsæt
            </Button>
          </div>
        </PageSectionBody>
      </PageSection>
    </PageShell>
  );
}
