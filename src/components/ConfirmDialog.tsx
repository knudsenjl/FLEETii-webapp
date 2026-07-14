// The standard "are you sure?" Nej/Ja confirmation dialog, built on top of
// Modal. Every destructive/confirmable action in the app (deleting a
// vehicle, cancelling a reservation, creating a user, etc.) renders one of
// these instead of a bespoke modal, so behavior (disabling buttons while
// pending, showing an error) stays consistent everywhere.
import type { ReactNode } from "react";
import { Modal } from "./Modal";

/** Props for ConfirmDialog. Only message/onCancel/onConfirm are required — labels and pending state are opt-in for callers that need them. */
interface ConfirmDialogProps {
  message: ReactNode;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  /** Label shown on the confirm button while isPending is true (falls back to confirmLabel if omitted). */
  confirmPendingLabel?: string;
  /** Disables both buttons (e.g. while a request is in flight) and swaps in confirmPendingLabel. */
  isPending?: boolean;
}

/** A Nej/Ja confirmation modal with an optional error message and pending state. Both buttons render with identical styling — there is no visual "danger" distinction between confirm and cancel, so double-check the message text is clear about what confirming will do. */
export function ConfirmDialog({
  message,
  error,
  onCancel,
  onConfirm,
  cancelLabel = "Nej",
  confirmLabel = "Ja",
  confirmPendingLabel,
  isPending = false,
}: ConfirmDialogProps) {
  return (
    <Modal>
      <p className="text-sm font-medium text-brand-800">{message}</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="rounded-lg bg-brand-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending && confirmPendingLabel ? confirmPendingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
