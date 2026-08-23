"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import KinescopePlayer from "@kinescope/player-iframe-api-loader/react/KinescopePlayer";
import StudentWatermark from "@/components/StudentWatermark";
import { isKinescopeVideoId } from "@/lib/video-id";
import {
  shouldResumeWatchProgress,
  type WatchProgress,
} from "@/lib/watch-progress";

export interface VideoPlayerProps {
  videoId: string;
  embedUrl?: string | null;
  lessonId?: string;
  initialWatchProgress?: WatchProgress | null;
  title?: string;
  discordId?: string;
  discordUsername?: string;
  protectedPlaybackConfigured: boolean;
}

export default function VideoPlayer({
  videoId,
  embedUrl,
  lessonId,
  initialWatchProgress,
  title = "Lesson video",
  discordId,
  discordUsername,
  protectedPlaybackConfigured,
}: VideoPlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cleanupPlayerRef = useRef<() => void>(() => {});
  const currentTimeRef = useRef(initialWatchProgress?.currentTime || 0);
  const durationRef = useRef(initialWatchProgress?.duration || 0);
  const lastSavedAtRef = useRef(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [watchPercent, setWatchPercent] = useState(
    initialWatchProgress?.percent || 0
  );
  const [resumeNotice, setResumeNotice] = useState(
    initialWatchProgress && shouldResumeWatchProgress(initialWatchProgress)
      ? `Resume ready at ${formatTime(initialWatchProgress.currentTime)}`
      : ""
  );
  const validVideoId = isKinescopeVideoId(videoId.trim());
  const validEmbedUrl = getKinescopeEmbedUrl(embedUrl);
  const playerOptions = useMemo(
    () => ({
      url: validEmbedUrl || "",
      size: { width: "100%", height: "100%" },
      behavior: {
        preload: "metadata" as const,
        playsInline: true,
        localStorage: { time: false },
      },
      ui: { language: "en" as const, controls: true },
    }),
    [validEmbedUrl]
  );

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const persistProgress = useCallback(
    (currentTime: number, duration: number, ended = false) => {
      if (!lessonId || duration <= 0) return;
      fetch("/api/lessons/watch-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ lessonId, currentTime, duration, ended }),
      }).catch(() => {});
    },
    [lessonId]
  );

  useEffect(() => {
    const flush = () =>
      persistProgress(currentTimeRef.current, durationRef.current);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [persistProgress]);

  const onPlayerCreate = useCallback(
    (player: Kinescope.IframePlayer.Player) => {
      const onLoaded: Kinescope.IframePlayer.Player.EventHandler<
        typeof player.Events.Loaded
      > = async ({ data }) => {
        durationRef.current = data.duration;
        currentTimeRef.current = data.currentTime;
        if (
          initialWatchProgress &&
          shouldResumeWatchProgress(initialWatchProgress) &&
          initialWatchProgress.currentTime < data.duration
        ) {
          try {
            await player.seekTo(initialWatchProgress.currentTime);
            currentTimeRef.current = initialWatchProgress.currentTime;
            setResumeNotice(`Resumed at ${formatTime(initialWatchProgress.currentTime)}`);
          } catch {
            setResumeNotice("Couldn’t resume automatically");
          }
        }
      };
      const onTimeUpdate: Kinescope.IframePlayer.Player.EventHandler<
        typeof player.Events.TimeUpdate
      > = ({ data }) => {
        currentTimeRef.current = data.currentTime;
        const percent = durationRef.current
          ? Math.min(100, Math.round((data.currentTime / durationRef.current) * 100))
          : Math.max(0, Math.min(100, Math.round(data.percent)));
        setWatchPercent(percent);
        if (Date.now() - lastSavedAtRef.current >= 10_000) {
          lastSavedAtRef.current = Date.now();
          persistProgress(data.currentTime, durationRef.current);
        }
      };
      const onPause = async () => {
        try {
          const [currentTime, duration] = await Promise.all([
            player.getCurrentTime(),
            player.getDuration(),
          ]);
          currentTimeRef.current = currentTime;
          durationRef.current = duration;
          persistProgress(currentTime, duration);
        } catch {
          setResumeNotice("Progress will retry automatically");
        }
      };
      const onEnded = () => {
        currentTimeRef.current = durationRef.current;
        setWatchPercent(100);
        setResumeNotice("Video watched");
        persistProgress(durationRef.current, durationRef.current, true);
      };
      const onError = () => setResumeNotice("Playback error — refresh to retry");

      player
        .on(player.Events.Loaded, onLoaded)
        .on(player.Events.TimeUpdate, onTimeUpdate)
        .on(player.Events.Pause, onPause)
        .on(player.Events.Ended, onEnded)
        .on(player.Events.Error, onError);
      cleanupPlayerRef.current = () => {
        player
          .off(player.Events.Loaded, onLoaded)
          .off(player.Events.TimeUpdate, onTimeUpdate)
          .off(player.Events.Pause, onPause)
          .off(player.Events.Ended, onEnded)
          .off(player.Events.Error, onError);
      };
    },
    [initialWatchProgress, persistProgress]
  );

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
    <div style={{ width: "100%" }}>
      <div
        ref={wrapperRef}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background: "#000",
          border: "1px solid rgba(231,192,113,0.15)",
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
            <KinescopePlayer
              options={playerOptions}
              onCreate={onPlayerCreate}
              onDestroy={() => cleanupPlayerRef.current()}
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
            <StudentWatermark
              discordId={discordId}
              discordUsername={discordUsername}
            />
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
      {!unavailableMessage && lessonId && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            padding: "9px 2px 0",
            color: "rgba(245,240,240,0.48)",
            fontFamily: "Georgia, serif",
            fontSize: "10px",
            letterSpacing: "0.8px",
          }}
          aria-live="polite"
        >
          <span>{resumeNotice || "Watch progress saves automatically"}</span>
          <span>{watchPercent}% watched</span>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
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
