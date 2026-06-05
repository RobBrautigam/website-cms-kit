"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Label to show while pending. Defaults to children. */
  pendingLabel?: ReactNode;
  className?: string;
}

/**
 * Submit button that disables itself while the parent `<form>`'s action is in
 * flight. Reads `pending` from React DOM's `useFormStatus()` hook. Must be
 * rendered as a descendant of a form whose `action` is a server action.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className = "btn-primary",
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} disabled:opacity-50`}
      aria-busy={pending}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
