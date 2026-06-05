import { requirePartialAdmin } from "@/lib/auth/require";
import { EnrollView } from "./EnrollView";

export const metadata = {
  robots: "noindex, nofollow",
};

/**
 * Forced 2FA enrollment page. Reached via the login flow when the grace
 * window has elapsed and the user has no verified factor. Lives OUTSIDE the
 * (admin) route group so the AdminShell chrome and the soft-prompt banner
 * don't render here — same pattern as /admin/login and /admin/reset-password.
 */
export default async function EnrollPage() {
  await requirePartialAdmin();
  return <EnrollView />;
}
