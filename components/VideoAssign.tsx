"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isKinescopeVideoId } from "@/lib/video-id";

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
 * Admin-only control to attach a Kinescope video to a lesson. The
 * Upload Video flow hands back an ID; this is where that ID gets bound to
 * a lesson, persisted as a `videoId` override (see /api/admin/lesson-overrides)
 * so no code change / redeploy is needed. Clearing it reverts the lesson to
 * whatever the curriculum declares — usually the "coming soon" placeholder.
 */
export default function VideoAssign({
  lessonId,
  currentVideoId,
}: VideoAssignProps) {
  const router = useRouter();
  const attached = isKinescopeVideoId(currentVideoId?.trim());

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
        setError(data?.error || "Could not save the Kinescope video ID.");
        return;
      }
      setDraft("");
      router.refresh();
    } catch {
      setError("Could not save the Kinescope video ID.");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const next = draft.trim();
    if (!next) {
      setError("Paste a Kinescope video ID first.");
      return;
    }
    if (!isKinescopeVideoId(next)) {
      setError("That doesn't look like a Kinescope video UUID.");
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
      <span style={{ ...TINY_CAPS, color: "rgba(231,192,113,0.6)" }}>Video</span>

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
        placeholder="Paste Kinescope video ID…"
        spellCheck={false}
        style={{
          flex: "0 1 280px",
          minWidth: "180px",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(231,192,113,0.2)",
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
          color: "#e3c071",
          background: "transparent",
          border: "1px solid #e3c071",
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
