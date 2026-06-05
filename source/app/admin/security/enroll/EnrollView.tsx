"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TwoFactorEnrollmentModal } from "@/components/admin/TwoFactorEnrollmentModal";

/**
 * Standalone forced-enrollment view. Reached when the login flow detects that
 * the grace window has elapsed and the user still has no verified factor.
 *
 * Reuses the existing TwoFactorEnrollmentModal in non-dismissable mode: the
 * onClose handler is a no-op, so the modal's own "I've saved these — Continue"
 * button is the only exit. The modal shell still wires the close affordance
 * to that no-op, which is intentional — there's nowhere to escape to until
 * the factor is verified.
 */
export function EnrollView() {
  const router = useRouter();
  const [done, setDone] = useState(false);

  return (
    <div className="mx-auto max-w-md py-12 px-4 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Enable two-factor authentication</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Two-factor authentication is required to continue. This is a one-time
          setup that takes about 90 seconds.
        </p>
      </header>
      <TwoFactorEnrollmentModal
        onClose={() => {
          /* No-op: the user cannot dismiss this view. The modal's
             "I've saved these — Continue" button is the only exit. */
        }}
        onComplete={() => {
          setDone(true);
          setTimeout(() => {
            router.push("/admin/posts");
            router.refresh();
          }, 200);
        }}
      />
      {done && (
        <p className="text-sm text-emerald-600">Enrolled. Redirecting…</p>
      )}
    </div>
  );
}
