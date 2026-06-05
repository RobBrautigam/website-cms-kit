import Link from "next/link";
import { mustEnforceMFA, FEATURE_SHIP_DATE, GRACE_DAYS } from "@/lib/auth/mfa";

/**
 * Soft prompt that appears at the top of every admin page during the MFA
 * grace window for users who haven't enrolled yet. After the grace window
 * elapses, this component returns null — at that point the login flow
 * hard-redirects unenrolled users to /admin/security/enroll, so the banner
 * is no longer the right surface.
 *
 * The "Set up now" CTA links to /admin/settings rather than the forced
 * enrollment page: settings is the natural home for non-required setup,
 * and the user stays in the normal admin shell.
 */
export function MFAEnrollmentBanner({
  hasFactor,
  userCreatedAt,
}: {
  hasFactor: boolean;
  userCreatedAt: string | null;
}) {
  if (hasFactor) return null;
  const enforce = mustEnforceMFA(userCreatedAt);
  if (enforce) return null; // hard redirect handles this case via /admin/security/enroll

  const created = userCreatedAt ? new Date(userCreatedAt) : FEATURE_SHIP_DATE;
  const start = created > FEATURE_SHIP_DATE ? created : FEATURE_SHIP_DATE;
  const cutoff = new Date(start.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <span className="text-amber-900">
          Two-factor authentication is required by{" "}
          <strong>{cutoff.toLocaleDateString()}</strong>.
        </span>
        <Link
          href="/admin/settings"
          className="rounded bg-text-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          Set up now
        </Link>
      </div>
    </div>
  );
}
