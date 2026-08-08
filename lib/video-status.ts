import "server-only";

import {
  getKinescopeConfig,
  kinescopeFetch,
  normalizeKinescopeVideo,
} from "./kinescope";
import { isKinescopeVideoId } from "./video-id";

const READY_TTL_MS = 10 * 60 * 1000;
const NOT_READY_TTL_MS = 30 * 1000;

export interface VideoPlaybackStatus {
  ready: boolean;
  embedUrl: string | null;
}

const globalCache = globalThis as unknown as {
  __dojoKinescopePlaybackCache?: Map<
    string,
    { playback: VideoPlaybackStatus; at: number }
  >;
};
const cache =
  globalCache.__dojoKinescopePlaybackCache ??
  (globalCache.__dojoKinescopePlaybackCache = new Map<
    string,
    { playback: VideoPlaybackStatus; at: number }
  >());

/** Kinescope videos become playable only when their status is exactly `done`. */
export async function isVideoReady(videoId: string): Promise<boolean> {
  return (await getVideoPlayback(videoId)).ready;
}

/** Resolve readiness and the provider-issued embed URL without exposing API data. */
export async function getVideoPlayback(
  videoId: string
): Promise<VideoPlaybackStatus> {
  const id = videoId.trim();
  if (!isKinescopeVideoId(id)) return { ready: false, embedUrl: null };

  const now = Date.now();
  const cached = cache.get(id);
  if (cached) {
    const ttl = cached.playback.ready ? READY_TTL_MS : NOT_READY_TTL_MS;
    if (now - cached.at < ttl) return cached.playback;
  }

  try {
    const { playerId } = getKinescopeConfig();
    const response = await kinescopeFetch(`/videos/${encodeURIComponent(id)}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => null);
    const rawVideo = payload?.data;
    if (
      !rawVideo ||
      typeof rawVideo !== "object" ||
      Array.isArray(rawVideo) ||
      (rawVideo as Record<string, unknown>).player_id !== playerId
    ) {
      const playback = { ready: false, embedUrl: null };
      cache.set(id, { playback, at: now });
      return playback;
    }
    const video = normalizeKinescopeVideo(rawVideo);
    const playback = {
      ready: video.ready,
      embedUrl: video.embedLink ?? null,
    };
    cache.set(id, { playback, at: now });
    return playback;
  } catch {
    return { ready: false, embedUrl: null };
  }
}
