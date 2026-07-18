import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000; // cache results 5 minutes

// Process-local cache, kept on globalThis so it survives dev HMR reloads.
const globalCache = globalThis as unknown as {
  __dojoIpCache?: Map<string, { blocked: boolean; at: number }>;
};
const cache =
  globalCache.__dojoIpCache ??
  (globalCache.__dojoIpCache = new Map<string, { blocked: boolean; at: number }>());

/**
 * Flags requests coming from a VPN / proxy / datacenter (hosting) IP using
 * ip-api.com. Falls open (blocked:false) on any lookup failure or when we
 * can't determine the client IP (e.g. local dev), so we never lock out a
 * legitimate member because of an infrastructure hiccup.
 */
export async function GET(req: NextRequest) {
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "";

  if (!ip) {
    return NextResponse.json({ blocked: false });
  }

  const now = Date.now();
  const cached = cache.get(ip);
  if (cached && now - cached.at < TTL_MS) {
    return NextResponse.json({ blocked: cached.blocked });
  }

  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,proxy,hosting`,
      { cache: "no-store" }
    );
    const data = await res.json();
    const blocked =
      data?.status === "success" && (data.proxy === true || data.hosting === true);

    cache.set(ip, { blocked, at: now });
    return NextResponse.json({ blocked });
  } catch {
    return NextResponse.json({ blocked: false });
  }
}
