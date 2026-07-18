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

export default function CloudflarePlayer({
  videoId,
  title = "Lesson video",
  autoplay = false,
}: CloudflarePlayerProps) {
  const params = new URLSearchParams();
  if (autoplay) params.set("autoplay", "true");
  const query = params.toString();
  const src = `https://iframe.cloudflarestream.com/${videoId}${
    query ? `?${query}` : ""
  }`;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        // 16:9 aspect ratio box.
        aspectRatio: "16 / 9",
        background: "#000",
        border: "1px solid rgba(196,24,24,0.15)",
        overflow: "hidden",
      }}
    >
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
    </div>
  );
}
