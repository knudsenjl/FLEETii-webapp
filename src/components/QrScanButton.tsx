// Small icon button that opens a full-screen camera overlay for scanning a
// QR code, and reports the decoded text back to the caller via `onScan`.
// Built on the `qr-scanner` package (nimiq/qr-scanner): it uses the
// browser's native BarcodeDetector where available, and transparently falls
// back to its own WASM/worker decoder otherwise — notably Safari on
// iPhone/iPad has no BarcodeDetector, so this fallback is what makes camera
// scanning actually work there too. In short: works uniformly on Windows
// (webcam), iPhone/iPad (Safari), and Android (Chrome), as long as the page
// is served over HTTPS (required for camera access; Netlify already does
// this) and the user grants camera permission when prompted.
import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

/** QR-scan icon button + (when open) a camera modal. Purely self-contained — owns its own open/error state and the QrScanner instance's lifecycle; the caller only ever sees the final decoded string via `onScan`. */
export function QrScanButton({ onScan }: { onScan: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Holds the latest onScan without needing it in the start/stop effect's
  // dependency array below — onScan is typically a fresh inline closure on
  // every parent render, and depending on it directly would tear down and
  // restart the camera stream on every keystroke elsewhere on the page.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Starts the camera + decoder while the modal is open, and always stops/
  // releases the camera stream when it closes or the component unmounts —
  // leaving a camera stream running in the background would be a real
  // privacy/battery problem, not just a cosmetic one.
  useEffect(() => {
    if (!open || !videoRef.current) return;

    setError(null);
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        onScanRef.current(result.data);
        setOpen(false);
      },
      { highlightScanRegion: true, highlightCodeOutline: true, preferredCamera: "environment" },
    );

    scanner.start().catch(() => {
      setError("Kunne ikke få adgang til kameraet. Tjek kameratilladelser i browseren.");
    });

    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Scan QR-kode"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-300 bg-brand-50 text-brand-600 transition hover:bg-brand-100"
      >
        {/* Heroicons "qr-code" outline glyph (fetched verbatim from the heroicons repo) — the three finder-pattern squares + scattered data-dots read as an actual QR code, unlike a hand-drawn approximation. strokeWidth kept at Heroicons' own default 1.5 (lighter than this app's usual 2) since the extra detail here blurs together at icon size otherwise. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
          <path d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z" />
          <path d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-brand-900/80 px-4">
          {/* muted + playsInline are required for iOS Safari to actually play the camera stream inline instead of refusing/going fullscreen. */}
          <video ref={videoRef} muted playsInline className="w-full max-w-sm overflow-hidden rounded-2xl" />
          {error && <p className="max-w-sm text-center text-sm text-white">{error}</p>}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-brand-800 transition hover:bg-brand-50"
          >
            Annuller
          </button>
        </div>
      )}
    </>
  );
}
