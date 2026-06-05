"use client";

import { useId } from "react";
import ModalShell from "./ModalShell";

export interface ConfirmDialogProps {
  /** Heading text. Wired to aria-labelledby. */
  title: string;
  /** Body copy under the heading. */
  description: string;
  /** Label for the confirm button. Shown as the gerund + ellipsis ("Deleting...")
   * while pending. */
  confirmLabel: string;
  /** Visual tone of the confirm button. */
  confirmTone: "danger" | "primary";
  /** When true, both buttons disable and the confirm shows "{label}..." */
  pending: boolean;
  /** Async handler for the confirm button. The parent owns navigation/toast. */
  onConfirm: () => void;
  /** Called for cancel button, escape, and backdrop click. The parent should
   * ignore the call when `pending` to prevent dismissing during a server round-trip. */
  onClose: () => void;
}

/**
 * AlertDialog modal for destructive (or otherwise high-stakes) confirmations.
 * Built on the existing `ModalShell` so it inherits focus trap, escape
 * dismiss, backdrop click dismiss, and aria-modal wiring.
 *
 * Use cases: row deletion, bulk operations, irreversible state changes.
 * For low-stakes confirmations (Are you sure you want to navigate away?),
 * a sonner toast with action buttons is a better fit.
 */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmTone,
  pending,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const titleId = useId();

  // Render the confirm label as a gerund ("Delete" -> "Deleting") while
  // the action is in flight. Drops a trailing silent "e" before appending
  // "ing" so we get "Deleting" not "Deleteing".
  const pendingLabel = (() => {
    const base = confirmLabel.trim();
    if (base.length === 0) return "...";
    const stem = base.toLowerCase().endsWith("e") ? base.slice(0, -1) : base;
    return `${stem}ing...`;
  })();

  const confirmClass =
    confirmTone === "danger"
      ? "px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      : "btn-primary px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <ModalShell onClose={pending ? () => {} : onClose} ariaLabelledBy={titleId}>
      <h2
        id={titleId}
        className="text-lg font-bold text-text-primary"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">{description}</p>
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="px-4 py-2 rounded-lg border border-border text-text-primary font-semibold hover:bg-bg-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={confirmClass}
          aria-busy={pending}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}
