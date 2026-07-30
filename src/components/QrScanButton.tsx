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
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-brand-600 transition hover:bg-brand-100"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3z" />
          <path d="M20 14v3" />
          <path d="M14 20h3" />
          <path d="M20 20h.01" />
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
