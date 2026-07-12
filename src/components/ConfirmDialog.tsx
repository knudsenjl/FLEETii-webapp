import type { ReactNode } from "react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  message: ReactNode;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmPendingLabel?: string;
  isPending?: boolean;
}

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
