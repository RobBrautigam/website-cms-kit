import { requirePartialAdmin } from "@/lib/auth/require";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// audit:exempt — read-only listing of caller's own MFA factors
export async function GET() {
  await requirePartialAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return Response.json([], { status: 200 });
  return Response.json(data?.totp ?? []);
}
