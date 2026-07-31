/**
 * Cloudflare Stream encoding status.
 *
 * A video that was uploaded seconds ago still exists as far as the embed is
 * concerned, but the player renders "an unknown error occurred" until
 * Cloudflare finishes encoding it. `isVideoReady` lets a server component ask
 * Cloudflare whether the upload is playable yet so we can show a calm
 * "processing" panel instead of that error.
 *
 * Fail-open by design: any hiccup (missing env, non-OK response, timeout,
 * unparseable body) resolves to `true`. A flaky API call must never black out
 * a video that actually works.
 */

const READY_TTL_MS = 10 * 60 * 1000; // a ready video stays ready — cache 10 min
const NOT_READY_TTL_MS = 30 * 1000; // recheck often so it flips live once encoded

// Process-local cache, kept on globalThis so it survives dev HMR reloads.
const globalCache = globalThis as unknown as {
  __dojoStreamReadyCache?: Map<string, { ready: boolean; at: number }>;
};
const cache =
  globalCache.__dojoStreamReadyCache ??
  (globalCache.__dojoStreamReadyCache = new Map<
    string,
    { ready: boolean; at: number }
  >());

function cloudflareConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

/**
 * True when Cloudflare reports `readyToStream` for this video — or when we
 * simply couldn't find out (see fail-open note above).
 */
export async function isVideoReady(videoId: string): Promise<boolean> {
  const id = (videoId || "").trim();
  if (!id) return true;

  const now = Date.now();
  const cached = cache.get(id);
  if (cached) {
    const ttl = cached.ready ? READY_TTL_MS : NOT_READY_TTL_MS;
    if (now - cached.at < ttl) return cached.ready;
  }

  const config = cloudflareConfig();
  if (!config) return true;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/stream/${id}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) return true;

    // `readyToStream` flips true as soon as the FIRST (lowest) rendition is
    // playable — students would get a 360p-only player while 1080p is still
    // encoding, which is unusable for chart content. Hold until the encode
    // state is fully "ready" (when the API reports a state at all).
    const readyToStream = data?.result?.readyToStream === true;
    const state = data?.result?.status?.state;
    const ready =
      readyToStream && (typeof state !== "string" || state === "ready");
    cache.set(id, { ready, at: now });
    return ready;
  } catch {
    return true;
  }
}
