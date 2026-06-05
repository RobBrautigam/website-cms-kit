"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import ConfirmDialog from "./ConfirmDialog";
import type { ActionResult } from "@/lib/admin/action-result";

interface Props {
  /** Server action with the row id ALREADY bound server-side via
   * `deleteRow.bind(null, row.id)`. The action takes no client args; this
   * preserves the invariant that the row id cannot be retargeted by client
   * tampering (never pass the id as a client-side argument or hidden input). */
  action: () => Promise<ActionResult>;
  /** Human-readable label for the dialog title and trigger button aria-label. */
  itemLabel: string;
  /** Toast copy on success (typically `"Job deleted: ${name}"`). */
  successCopy: string;
  /** Override the trigger button class. */
  className?: string;
  /** Override the trigger button text. */
  triggerLabel?: ReactNode;
}

/**
 * Renders a trigger button that opens a `ConfirmDialog`. On confirm: invokes
 * the bound server action, dispatches `toast.success` on `{ok: true}` or
 * `toast.error(result.error)` on `{ok: false}`. The dialog closes on success
 * and stays open on failure so the user can read the error and retry.
 *
 * IMPORTANT: the action MUST be bound to the row id via
 * `deleteRow.bind(null, row.id)` at the call site. Do NOT use a hidden input
 * or pass the id as a client-side argument; binding server-side is what stops
 * a tampered client from deleting an arbitrary row.
 */
export default function RowDeleteButton({
  action,
  itemLabel,
  successCopy,
  className = "text-red-600 hover:underline",
  triggerLabel = "Delete",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(successCopy);
        setOpen(false);
      } else {
        toast.error(result.error);
        // Keep dialog open so the user can read the error and decide what to do.
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${itemLabel}`}
        className={className}
      >
        {triggerLabel}
      </button>
      {open && (
        <ConfirmDialog
          title={`Delete ${itemLabel}?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          confirmTone="danger"
          pending={pending}
          onConfirm={handleConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
