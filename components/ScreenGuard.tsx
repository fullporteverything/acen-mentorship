"use client";

import { useEffect, useState } from "react";

interface ScreenGuardProps {
  discordId?: string;
  discordUsername?: string;
  isAdmin?: boolean;
  children: React.ReactNode;
}

/**
 * Best-effort screen-recording deterrent. Monkey-patches
 * navigator.mediaDevices.getDisplayMedia so that any attempt to start a screen
 * share / recording is logged server-side and slammed with a full-screen lock.
 *
 * This is a secondary deterrent. Protected playback and recording restrictions
 * are configured in Kinescope; client-side code cannot block external capture.
 */
export default function ScreenGuard({
  discordId,
  discordUsername,
  isAdmin = false,
  children,
}: ScreenGuardProps) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (
      isAdmin ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      return;
    }

    const md = navigator.mediaDevices;
    const original = md.getDisplayMedia;

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

      setLocked(true);
      throw new DOMException("Permission denied", "NotAllowedError");
    };

    md.getDisplayMedia = patched as typeof md.getDisplayMedia;

    return () => {
      md.getDisplayMedia = original;
    };
  }, [discordId, discordUsername, isAdmin]);

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
              color: "#E8A0A0",
              textTransform: "uppercase",
              letterSpacing: "6px",
              fontSize: "clamp(20px, 4vw, 34px)",
              fontWeight: 400,
              marginBottom: "20px",
            }}
          >
            Screen Capture Blocked
          </h1>
          <div
            style={{
              width: "40px",
              height: "1px",
              background:
                "linear-gradient(90deg, transparent, #E8A0A0, transparent)",
              marginBottom: "20px",
            }}
          />
          <p
            style={{
              fontFamily: "Georgia, serif",
              color: "rgba(245,240,240,0.55)",
              fontStyle: "italic",
              fontSize: "14px",
              letterSpacing: "1px",
            }}
          >
            Protected lesson playback cannot be shared or recorded from this page.
          </p>
        </div>
      )}
    </>
  );
}
