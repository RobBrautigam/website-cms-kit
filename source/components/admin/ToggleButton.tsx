"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/admin/action-result";

interface Props {
  /** Server-truth current value of the toggled flag. */
  currentValue: boolean;
  /** Label rendered when the value is true. */
  onLabel: string;
  /** Label rendered when the value is false. */
  offLabel: string;
  /** className applied when value is true. */
  onClass: string;
  /** className applied when value is false. */
  offClass: string;
  /**
   * Server action; receives the *new* value the user wants to set.
   *
   * IMPORTANT: when this component is rendered from a server component
   * (e.g., `src/app/(admin)/admin/jobs/page.tsx`), the `action` prop must be
   * a server action — either the imported function directly, or a bound
   * version like `toggleJobActive.bind(null, job.id)`. Plain arrow closures
   * (`(next) => toggleJobActive(job.id, next)`) cannot cross the RSC→client
   * boundary and will throw "Functions cannot be passed directly to Client
   * Components" at request time.
   */
  action: (next: boolean) => Promise<ActionResult>;
  /** Toast copy when the toggle settles to ON (true). */
  onSuccessCopy: string;
  /** Toast copy when the toggle settles to OFF (false). */
  offSuccessCopy: string;
  /** Override the wrapper button class shape (size, padding). */
  className?: string;
}

/**
 * Optimistic on/off toggle. On click:
 *   1. Optimistically flips the rendered label/style.
 *   2. Calls the bound server action.
 *   3. On success: toast.success + revalidation re-renders with the new
 *      server-truth value (matches the optimistic value).
 *   4. On failure: toast.error + the optimistic value snaps back when the
 *      transition completes (useOptimistic auto-reverts).
 *
 * Replaces the inline `<form action={async () => { "use server"; ... }}>`
 * pattern that wrapped per-row toggle buttons in the admin tables.
 */
export default function ToggleButton({
  currentValue,
  onLabel,
  offLabel,
  onClass,
  offClass,
  action,
  onSuccessCopy,
  offSuccessCopy,
  className = "text-xs font-semibold px-3 py-1 rounded-full",
}: Props) {
  const [optimistic, setOptimistic] = useOptimistic(currentValue);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    const next = !optimistic;
    startTransition(async () => {
      setOptimistic(next);
      const result = await action(next);
      if (result.ok) {
        toast.success(next ? onSuccessCopy : offSuccessCopy);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={optimistic}
      className={`${className} ${optimistic ? onClass : offClass} disabled:opacity-50`}
    >
      {optimistic ? onLabel : offLabel}
    </button>
  );
}
