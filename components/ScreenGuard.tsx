"use client";

import { useEffect, useState } from "react";

interface ScreenGuardProps {
  discordId?: string;
  discordUsername?: string;
  children: React.ReactNode;
}

/**
 * Best-effort screen-recording deterrent. Monkey-patches
 * navigator.mediaDevices.getDisplayMedia so that any attempt to start a screen
 * share / recording is logged server-side and slammed with a full-screen lock.
 *
 * This is a deterrent, not real DRM — a determined user can disable JS or use
 * an external camera. The protected video itself is DRM'd via Cloudflare Stream.
 *
 * Hidden escape hatch: set `window.__dojoAdminUnlock = true` in the console to
 * let the capture through / release the lock (used for admin recording).
 */
export default function ScreenGuard({
  discordId,
  discordUsername,
  children,
}: ScreenGuardProps) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

    const md = navigator.mediaDevices;
    const original = md.getDisplayMedia?.bind(md);

    const patched = async (
      constraints?: DisplayMediaStreamOptions
    ): Promise<MediaStream> => {
      // Log the attempt (fire-and-forget).
      fetch("/api/security/log-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordId,
          discordUsername,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {});

      // Admin escape hatch — let the real capture through.
      if (typeof window !== "undefined" && (window as any).__dojoAdminUnlock === true) {
        if (original) return original(constraints);
        throw new DOMException("Not supported", "NotSupportedError");
      }

      setLocked(true);
      throw new DOMException("Permission denied", "NotAllowedError");
    };

    md.getDisplayMedia = patched as typeof md.getDisplayMedia;

    return () => {
      if (original) {
        md.getDisplayMedia = original;
      }
    };
  }, [discordId, discordUsername]);

  // While locked, watch for the admin unlock flag and release.
  useEffect(() => {
    if (!locked) return;
    const interval = setInterval(() => {
      if (typeof window !== "undefined" && (window as any).__dojoAdminUnlock === true) {
        setLocked(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [locked]);

  return (
    <>
      {children}
      {locked && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "#000",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "24px",
            userSelect: "none",
          }}
        >
          <h1
            style={{
              fontFamily: "Georgia, serif",
              color: "#C41818",
              textTransform: "uppercase",
              letterSpacing: "6px",
              fontSize: "clamp(20px, 4vw, 34px)",
              fontWeight: 400,
              marginBottom: "20px",
            }}
          >
            Screen Recording Detected
          </h1>
          <div
            style={{
              width: "40px",
              height: "1px",
              background:
                "linear-gradient(90deg, transparent, #C41818, transparent)",
              marginBottom: "20px",
            }}
          />
          <p
            style={{
              fontFamily: "Georgia, serif",
              color: "rgba(240,237,230,0.55)",
              fontStyle: "italic",
              fontSize: "14px",
              letterSpacing: "1px",
            }}
          >
            lol nice try thanks for the free bread
          </p>
        </div>
      )}
    </>
  );
}
