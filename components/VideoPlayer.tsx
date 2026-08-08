"use client";

import { useEffect, useRef, useState } from "react";
import StudentWatermark from "@/components/StudentWatermark";
import { isKinescopeVideoId } from "@/lib/video-id";

export interface VideoPlayerProps {
  videoId: string;
  embedUrl?: string | null;
  title?: string;
  discordId?: string;
  discordUsername?: string;
  isAdmin: boolean;
  protectedPlaybackConfigured: boolean;
}

export default function VideoPlayer({
  videoId,
  embedUrl,
  title = "Lesson video",
  discordId,
  discordUsername,
  isAdmin,
  protectedPlaybackConfigured,
}: VideoPlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const validVideoId = isKinescopeVideoId(videoId.trim());
  const validEmbedUrl = getKinescopeEmbedUrl(embedUrl);

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === wrapperRef.current) {
        await document.exitFullscreen();
      } else {
        await wrapperRef.current?.requestFullscreen();
      }
    } catch {
      // The browser can deny fullscreen; playback remains available in-page.
    }
  }

  const unavailableMessage = !validVideoId
    ? "video coming soon"
    : !protectedPlaybackConfigured
      ? "protected playback is not configured"
      : !validEmbedUrl
        ? "protected playback is unavailable"
      : "";

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#000",
        border: "1px solid rgba(232,160,160,0.15)",
        overflow: "hidden",
      }}
    >
      {unavailableMessage ? (
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
            textAlign: "center",
            padding: "0 20px",
          }}
        >
          {unavailableMessage}
        </div>
      ) : (
        <>
          <iframe
            src={validEmbedUrl!}
            title={title}
            loading="lazy"
            allow="autoplay; encrypted-media"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
            }}
          />
          {!isAdmin && (
            <StudentWatermark
              discordId={discordId}
              discordUsername={discordUsername}
            />
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            style={{
              position: "absolute",
              right: "12px",
              bottom: "12px",
              zIndex: 5,
              padding: "7px 10px",
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(0,0,0,0.72)",
              color: "rgba(255,255,255,0.85)",
              fontFamily: "Georgia, serif",
              fontSize: "10px",
              letterSpacing: "1px",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
        </>
      )}
    </div>
  );
}

function getKinescopeEmbedUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "kinescope.io" &&
      url.pathname.startsWith("/embed/")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
