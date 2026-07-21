"use client";

import { useEffect, useRef, useState } from "react";

interface CaptionControlsProps {
  videoId: string;
}

interface CaptionTrack {
  language: string;
  label: string;
  status?: string;
}

const TINY_CAPS: React.CSSProperties = {
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
};

const POLL_INTERVAL_MS = 20000;
const MAX_POLLS = 10;

/**
 * Admin-only caption controls, rendered under the lesson video. Checks whether
 * Cloudflare already has a caption track; if not, offers a "Generate Captions"
 * button that kicks off Cloudflare's AI caption generation and then polls until
 * the track appears. Students automatically get a CC toggle in the player once
 * a track exists — nothing here is shown to them.
 */
export default function CaptionControls({ videoId }: CaptionControlsProps) {
  const [captions, setCaptions] = useState<CaptionTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");

  // Track mounted state + any active poll timer so we can clean up on unmount.
  const mountedRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);

  const hasTrack = captions.length > 0;

  async function fetchCaptions(): Promise<CaptionTrack[]> {
    const res = await fetch(
      `/api/admin/captions?videoId=${encodeURIComponent(videoId)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Could not check caption status.");
    }
    return Array.isArray(data?.captions) ? data.captions : [];
  }

  // Initial status check on mount.
  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      try {
        const found = await fetchCaptions();
        if (!mountedRef.current) return;
        setCaptions(found);
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : "Could not check captions.");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  function schedulePoll() {
    if (pollCountRef.current >= MAX_POLLS) return;
    pollTimerRef.current = setTimeout(async () => {
      pollCountRef.current += 1;
      try {
        const found = await fetchCaptions();
        if (!mountedRef.current) return;
        if (found.length > 0) {
          setCaptions(found);
          return; // Track appeared — stop polling.
        }
      } catch {
        // Swallow transient poll errors; keep trying until the cap.
      }
      if (mountedRef.current && pollCountRef.current < MAX_POLLS) {
        schedulePoll();
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleGenerate() {
    setError("");
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to generate captions.");
      }
      if (!mountedRef.current) return;
      setRequested(true);
      pollCountRef.current = 0;
      schedulePoll();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to generate captions.");
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{ ...TINY_CAPS, color: "rgba(245,240,240,0.35)", padding: "4px 0" }}
      >
        Checking captions…
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "12px",
        padding: "4px 0",
      }}
    >
      {hasTrack ? (
        <>
          <span style={{ ...TINY_CAPS, color: "rgba(245,240,240,0.55)" }}>
            Captions: English ✓
          </span>
          <span
            style={{
              fontSize: "9px",
              letterSpacing: "1px",
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              color: "rgba(245,240,240,0.3)",
            }}
          >
            students toggle via CC in the player
          </span>
        </>
      ) : requested ? (
        <span
          style={{
            fontSize: "10px",
            letterSpacing: "1px",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "rgba(245,240,240,0.45)",
          }}
        >
          Captions requested — processing takes a few minutes.
        </span>
      ) : (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          style={{
            ...TINY_CAPS,
            color: "#E8A0A0",
            background: "transparent",
            border: "1px solid #E8A0A0",
            padding: "7px 14px",
            cursor: generating ? "default" : "pointer",
            opacity: generating ? 0.6 : 1,
          }}
        >
          {generating ? "Generating…" : "Generate Captions"}
        </button>
      )}

      {error && (
        <span
          style={{
            fontSize: "10px",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#E8807A",
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
