"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import KinescopePlayer from "@kinescope/player-iframe-api-loader/react/KinescopePlayer";
import StudentWatermark, { watermarkText } from "@/components/StudentWatermark";
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
  const playerRef = useRef<Kinescope.IframePlayer.Player | null>(null);
  /** Was the video playing when the viewer left? Drives auto-resume. */
  const resumeOnReturnRef = useRef(false);
  const cleanupPlayerRef = useRef<() => void>(() => {});
  const currentTimeRef = useRef(initialWatchProgress?.currentTime || 0);
  const durationRef = useRef(initialWatchProgress?.duration || 0);
  const lastSavedAtRef = useRef(0);
  const [fullscreen, setFullscreen] = useState(false);
  /** True while the viewer is away — tab hidden or window unfocused. */
  const [away, setAway] = useState(false);
  /** Bumped to force-remount the watermark if it is torn out of the DOM. */
  const [watermarkKey, setWatermarkKey] = useState(0);
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
  const viewerLabel = watermarkText({ discordId, discordUsername });
  const playerOptions = useMemo(
    () => ({
      url: validEmbedUrl || "",
      size: { width: "100%", height: "100%" },
      behavior: {
        preload: "metadata" as const,
        playsInline: true,
        localStorage: { time: false },
      },
      ui: {
        language: "en" as const,
        controls: true,
        // The player's own screenshot button would hand a member a clean,
        // watermark-free frame in one click. Off.
        screenshotButton: false,
        /**
         * NATIVE WATERMARK — the important one.
         *
         * StudentWatermark below draws the same label in OUR DOM, which a
         * member can delete from devtools in one click. This one is composited
         * INSIDE Kinescope's cross-origin iframe: our page cannot reach it, so
         * neither can anyone using our page's devtools. It is what actually
         * survives into a screen recording or a phone video of the monitor.
         *
         * `random` moves it so a fixed crop can't remove it; the visible/hidden
         * cycle keeps it from sitting over the chart the whole lesson. Any
         * single appearance is enough to trace a leak back to an account.
         */
        watermark: {
          text: viewerLabel,
          mode: "random" as const,
          scale: 0.16,
          displayTimeout: { visible: 8000, hidden: 5000 },
        },
      },
      theme: {
        // Both keys are required by the player's option type.
        watermark: { default: { color: "rgba(255,255,255,0.55)" } },
        colors: { primary: "#e3c071" },
      },
      // Tags Kinescope's OWN view metrics with the member, so a leak can be
      // traced provider-side even if every pixel of our page is stripped.
      settings: { externalId: discordId?.trim() || "unknown" },
    }),
    [validEmbedUrl, viewerLabel, discordId]
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

      playerRef.current = player;
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
        playerRef.current = null;
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

  /**
   * Away guard. While the tab is hidden or the window unfocused the video both
   * BLURS and PAUSES — a member can't leave a lesson running on a second
   * monitor and record it while working elsewhere.
   *
   * The pause is the part that matters. The blur is a CSS filter, so anyone
   * with devtools deletes it in a click and keeps recording; pausing stops the
   * frames at the source, inside a cross-origin iframe we can't be talked out
   * of. It also stops the audio, which the blur never did.
   *
   * The subtle bit: clicking INTO the player moves focus to the iframe and
   * fires window.blur, but document.hasFocus() stays true while any embedded
   * context holds focus — so the check runs a tick later and only fires when
   * focus has truly left the page.
   */
  const leave = useCallback(() => {
    setAway(true);
    const player = playerRef.current;
    if (!player) return;
    player
      .isPaused()
      .then((paused) => {
        if (paused) return;
        resumeOnReturnRef.current = true;
        return player.pause();
      })
      .catch(() => {});
  }, []);

  const returnToLesson = useCallback(() => {
    setAway(false);
    if (!resumeOnReturnRef.current) return;
    // Resume only what WE paused, so a member who deliberately hit pause before
    // alt-tabbing doesn't come back to a video that started itself.
    resumeOnReturnRef.current = false;
    playerRef.current?.play().catch(() => {});
  }, []);

  useEffect(() => {
    const onBlur = () => {
      window.setTimeout(() => {
        if (!document.hasFocus()) leave();
      }, 0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave();
      else if (document.hasFocus()) returnToLesson();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", returnToLesson);
    window.addEventListener("pointerdown", returnToLesson);
    window.addEventListener("keydown", returnToLesson);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", returnToLesson);
      window.removeEventListener("pointerdown", returnToLesson);
      window.removeEventListener("keydown", returnToLesson);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [leave, returnToLesson]);

  /**
   * Watermark tamper check. StudentWatermark is an ordinary DOM node, so the
   * one-click devtools "Delete element" gives a clean recording. Every two
   * seconds we confirm it is still attached and still painted; if it isn't, the
   * video pauses and the node is remounted.
   *
   * Deliberately NOT wired to security strikes. It's a heuristic reading of
   * computed styles and could in principle misfire — costing a member a pause
   * and a click is fine, costing them a strike is not.
   */
  useEffect(() => {
    if (!validEmbedUrl) return;
    const timer = window.setInterval(() => {
      const mark = wrapperRef.current?.querySelector("[data-s7-watermark]");
      const style = mark ? getComputedStyle(mark) : null;
      const intact =
        Boolean(mark?.isConnected) &&
        style !== null &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0.05;
      if (intact) return;
      playerRef.current?.pause().catch(() => {});
      setWatermarkKey((value) => value + 1);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [validEmbedUrl]);

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
            <div
              aria-hidden={away}
              style={{
                position: "absolute",
                inset: 0,
                filter: away ? "blur(26px) brightness(0.45) saturate(0.7)" : "none",
                // A slight zoom hides the blur's bright edge fringe.
                transform: away ? "scale(1.08)" : "none",
                transition: "filter 0.35s ease, transform 0.35s ease",
              }}
            >
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
              key={watermarkKey}
              discordId={discordId}
              discordUsername={discordUsername}
            />
            </div>
            {away ? (
              <button
                type="button"
                onClick={() => {
                  window.focus();
                  returnToLesson();
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 6,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  border: "none",
                  background: "rgba(5,4,2,0.35)",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: "10px",
                    letterSpacing: "4px",
                    textTransform: "uppercase",
                    color: "#e3c071",
                  }}
                >
                  Hidden while you&apos;re away
                </span>
                <span
                  style={{
                    fontFamily: "Georgia, serif",
                    fontStyle: "italic",
                    fontSize: "11px",
                    letterSpacing: "1px",
                    color: "rgba(245,240,240,0.55)",
                  }}
                >
                  click to return
                </span>
              </button>
            ) : null}
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
