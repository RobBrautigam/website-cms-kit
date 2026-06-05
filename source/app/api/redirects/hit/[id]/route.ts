import { NextResponse, type NextRequest } from "next/server";
import { recordHit } from "@/lib/redirects/lookup";
import { isBot } from "@/lib/redirects/bot-detect";

/**
 * Beacon endpoint for internal-redirect hit telemetry.
 *
 * Called from <RedirectBeacon> on the destination page when an `app_r=<id>`
 * cookie is present (set by the proxy on the redirect response).
 *
 * Always returns 204 No Content — we don't want to leak whether a given
 * id maps to a real redirect, and the client-side beacon ignores the
 * response either way.
 *
 * The handler runs `recordHit()` server-side. recordHit is fire-and-forget
 * but we await it so a transient Supabase error doesn't kill the request
 * silently in dev.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noStoreHeaders: Record<string, string> = {
  "Cache-Control": "no-store",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return new NextResponse(null, { status: 400, headers: noStoreHeaders });
  }

  const ua = request.headers.get("user-agent");
  if (isBot(ua)) {
    // Acknowledge the request so beacon clients don't retry, but skip the
    // count. 204 keeps the API surface uniform.
    return new NextResponse(null, { status: 204, headers: noStoreHeaders });
  }

  try {
    await recordHit(id);
  } catch {
    // Silently swallow — telemetry is best-effort. The cookie is already
    // gone by the time the beacon fires, so retry isn't possible anyway.
  }

  return new NextResponse(null, { status: 204, headers: noStoreHeaders });
}
