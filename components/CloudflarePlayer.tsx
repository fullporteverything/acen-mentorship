/**
 * Cloudflare Stream player.
 *
 * Renders a DRM-capable iframe against Cloudflare Stream. The widevine/
 * fairplay/playready handshake is negotiated by the embedded player itself;
 * we just have to grant it the `encrypted-media` permissions and keep a clean
 * 16:9 frame. No client-side JS required, so this stays a server component.
 */

interface CloudflarePlayerProps {
  videoId: string;
  /** Optional poster/title for a11y — falls back to a generic label. */
  title?: string;
  autoplay?: boolean;
}

/**
 * A real Cloudflare Stream UID is a 32-char lowercase hex string. Treat
 * anything that can't plausibly be one — empty, whitespace, obvious
 * placeholders (`YOUR_VIDEO_ID_HERE`), or anything with spaces/underscores or
 * shorter than 16 chars — as "no video yet" rather than letting Cloudflare
 * render its ugly "no video id or valid token found in path" error.
 */
function isValidVideoId(videoId: string | undefined | null): boolean {
  if (!videoId) return false;
  const id = videoId.trim();
  if (id.length < 16) return false;
  if (/\s/.test(id)) return false;
  if (id.includes("_")) return false;
  if (/YOUR_VIDEO/i.test(id)) return false;
  return true;
}

/**
 * Cloudflare defaults the poster to the frame at 0s, which is very often a
 * black frame. Without knowing each video's duration we can't pick a "middle"
 * frame, so we derive a deterministic timestamp from the videoId itself and
 * clamp it into a small 3–20s window — small enough that virtually any lesson
 * video is longer, so the frame reliably exists, while still varying per
 * video so thumbnails don't all look identical.
 */
function posterTimeSeconds(videoId: string): number {
  let hash = 0;
  for (let i = 0; i < videoId.length; i += 1) {
    hash = (hash + videoId.charCodeAt(i)) % 1000;
  }
  // Map the 0–999 hash into the inclusive 3–20 second range.
  return 3 + (hash % 18);
}

export default function CloudflarePlayer({
  videoId,
  title = "Lesson video",
  autoplay = false,
}: CloudflarePlayerProps) {
  const frame = (
    <div
      style={{
        position: "relative",
        width: "100%",
        // 16:9 aspect ratio box.
        aspectRatio: "16 / 9",
        background: "#000",
        border: "1px solid rgba(232,160,160,0.15)",
        overflow: "hidden",
      }}
    >
      {isValidVideoId(videoId) ? renderIframe() : renderComingSoon()}
    </div>
  );

  function renderIframe() {
    const params = new URLSearchParams();
    if (autoplay) params.set("autoplay", "true");

    const time = posterTimeSeconds(videoId);
    const posterUrl = `https://videodelivery.net/${videoId}/thumbnails/thumbnail.jpg?time=${time}s&height=720`;
    params.set("poster", posterUrl);

    const src = `https://iframe.cloudflarestream.com/${videoId}?${params.toString()}`;

    return (
      <iframe
        src={src}
        title={title}
        loading="lazy"
        // DRM / protected-media permissions required by Cloudflare Stream.
        allow="accelerated-encrypted-media; encrypted-media; autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: "none",
        }}
      />
    );
  }

  function renderComingSoon() {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Georgia, serif",
          fontSize: "0.7rem",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "rgba(245,240,240,0.25)",
        }}
      >
        video coming soon
      </div>
    );
  }

  return frame;
}
