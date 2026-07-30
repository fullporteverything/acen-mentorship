"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface VideoAssignProps {
  lessonId: string;
  /** The lesson's effective videoId, if it already has a usable one. */
  currentVideoId?: string;
}

const TINY_CAPS: React.CSSProperties = {
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
};

/**
 * Same "is this a real Cloudflare Stream UID?" heuristic as
 * components/CloudflarePlayer.tsx — checked here so an obvious typo never even
 * reaches the API.
 */
function isPlausibleVideoId(videoId: string | undefined | null): boolean {
  if (!videoId) return false;
  const id = videoId.trim();
  if (id.length < 16) return false;
  if (/\s/.test(id)) return false;
  if (id.includes("_")) return false;
  if (/YOUR_VIDEO/i.test(id)) return false;
  return true;
}

/**
 * Admin-only control to attach a Cloudflare Stream video to a lesson. The
 * Upload Video flow only hands back a UID; this is where that UID gets bound to
 * a lesson, persisted as a `videoId` override (see /api/admin/lesson-overrides)
 * so no code change / redeploy is needed. Clearing it reverts the lesson to
 * whatever the curriculum declares — usually the "coming soon" placeholder.
 */
export default function VideoAssign({
  lessonId,
  currentVideoId,
}: VideoAssignProps) {
  const router = useRouter();
  const attached = isPlausibleVideoId(currentVideoId);

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A refresh brought in a new video — drop any stale draft.
  useEffect(() => {
    setDraft("");
  }, [currentVideoId]);

  async function post(value: string) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/lesson-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, field: "videoId", value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not save the video UID.");
        return;
      }
      setDraft("");
      router.refresh();
    } catch {
      setError("Could not save the video UID.");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const next = draft.trim();
    if (!next) {
      setError("Paste a Cloudflare video UID first.");
      return;
    }
    if (!isPlausibleVideoId(next)) {
      setError(
        "That doesn't look like a Stream UID — expect 32 hex characters, no spaces or underscores."
      );
      return;
    }
    post(next);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "10px",
        padding: "4px 0",
      }}
    >
      <span style={{ ...TINY_CAPS, color: "rgba(232,160,160,0.6)" }}>Video</span>

      {attached ? (
        <span
          style={{
            fontSize: "10px",
            letterSpacing: "1px",
            fontFamily: "Georgia, serif",
            color: "rgba(245,240,240,0.55)",
            wordBreak: "break-all",
          }}
        >
          {currentVideoId}
        </span>
      ) : (
        <span
          style={{
            fontSize: "10px",
            letterSpacing: "1px",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "rgba(245,240,240,0.3)",
          }}
        >
          no video attached
        </span>
      )}

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Paste Cloudflare video UID…"
        spellCheck={false}
        style={{
          flex: "0 1 280px",
          minWidth: "180px",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(232,160,160,0.2)",
          color: "#F5F0F0",
          fontFamily: "Georgia, serif",
          fontSize: "11px",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      <button
        type="button"
        onClick={save}
        disabled={saving}
        style={{
          ...TINY_CAPS,
          color: "#E8A0A0",
          background: "transparent",
          border: "1px solid #E8A0A0",
          padding: "7px 14px",
          cursor: saving ? "default" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? "Saving…" : attached ? "Replace" : "Save"}
      </button>

      {attached && (
        <button
          type="button"
          onClick={() => post("")}
          disabled={saving}
          style={{
            ...TINY_CAPS,
            color: "rgba(245,240,240,0.4)",
            background: "transparent",
            border: "none",
            padding: "7px 4px",
            textDecoration: "underline",
            cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          Clear
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
