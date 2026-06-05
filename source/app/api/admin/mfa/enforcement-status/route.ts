import { requirePartialAdmin } from "@/lib/auth/require";
import { mustEnforceMFA } from "@/lib/auth/mfa";

// audit:exempt — read-only check used by the LoginForm to decide UI routing
export async function GET() {
  const { user } = await requirePartialAdmin();
  return Response.json({ must_enforce: mustEnforceMFA(user.created_at ?? null) });
}
