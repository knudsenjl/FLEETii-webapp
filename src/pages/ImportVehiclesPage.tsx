// Bulk vehicle-import page ("/import-vehicles" — reached via
// VehiclesPage.tsx's "Opret køretøjer fra fil" button). Thin wrapper around
// BulkImportPage (see its own doc comment for the shared mechanics) — POSTs
// to netlify/functions/bulk-import-vehicles.mts, adapted for vehicles'
// extra "this only creates a pending order, not a live vehicle" caveat (see
// that function's own doc comment — a real vehicle needs a QR code
// physically scanned off the installed 2hire hardware, which can't come
// from a bulk file).
import { BulkImportPage } from "../components/BulkImportPage";

export function ImportVehiclesPage() {
  return (
    <BulkImportPage
      pageTitle="Opret køretøjer fra fil"
      endpoint="bulk-import-vehicles"
      templateBaseName="koretojer"
      nounPlural="Køretøjer"
      introExtra={
        <p className="text-sm text-brand-800">
          Hvert køretøj oprettes som en afventende bestilling, ligesom "Opret køretøj" — en sysadm
          skal stadig registrere hvert køretøj enkeltvis, da det kræver speciel konfigurering af hvert køretøj.
        </p>
      }
      formatResultNoun={(count) => `${count} køretøjsbestilling${count === 1 ? "" : "er"}`}
    />
  );
}
