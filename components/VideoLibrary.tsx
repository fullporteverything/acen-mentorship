"use client";

import { useEffect, useState } from "react";

interface LibraryVideo {
  id: string;
  title: string;
  createdAt: string;
  duration: number | null;
  status: string;
  progress: number | null;
  ready: boolean;
  error?: string;
  attachedTo: string | null;
}

/**
 * Persistent list of every video in the Kinescope project.
 *
 * VideoUpload only shows an ID for the video you just uploaded, and only until
 * the page reloads. This section is the permanent record: every ID stays
 * copyable forever, alongside which lesson it's attached to (if any).
 */
export default function VideoLibrary() {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/videos")
      .then((res) => {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setVideos(Array.isArray(data?.videos) ? data.videos : []);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Video Library</p>
      {loading ? (
        <SkeletonBar width="200px" />
      ) : error ? (
        <p style={errorItalic}>Couldn&apos;t load videos — refresh to retry.</p>
      ) : videos.length === 0 ? (
        <p style={mutedItalic}>No videos uploaded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {videos.map((video) => (
            <VideoRow key={video.id} video={video} />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoRow({ video }: { video: LibraryVideo }) {
  const [copied, setCopied] = useState(false);
  const stateLabel = video.error
    ? "Processing failed"
    : video.ready
      ? "Ready to assign"
      : `Processing${video.progress !== null ? ` · ${Math.round(video.progress)}%` : ""}`;

  async function copyUid() {
    try {
      await navigator.clipboard.writeText(video.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable; the ID is still visible to copy manually.
    }
  }

  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid rgba(232,160,160,0.10)",
        background: "rgba(0,0,0,0.25)",
        fontFamily: "Georgia, serif",
      }}
    >
      <p style={{ fontSize: "13px", color: "#F5F0F0", marginBottom: "4px" }}>
        {video.title}
        <span className={`video-state ${video.error ? "error" : video.ready ? "ready" : "processing"}`}>
          {stateLabel}
        </span>
      </p>
      <p
        style={{
          fontSize: "11px",
          color: "rgba(245,240,240,0.45)",
          marginBottom: "10px",
        }}
      >
        {formatCreated(video.createdAt)}
        {video.duration !== null ? ` · ${formatDuration(video.duration)}` : ""}
        {video.error ? (
          <span style={{ color: "#E8807A", fontStyle: "italic" }}>
            {" "}· {video.error}
          </span>
        ) : !video.ready ? (
          <span style={{ color: "rgba(232,160,160,0.7)", fontStyle: "italic" }}>
            {" "}· {video.status}
            {video.progress !== null ? ` (${Math.round(video.progress)}%)` : ""}
          </span>
        ) : null}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <code
          style={{
            fontSize: "11px",
            color: "#F5F0F0",
            wordBreak: "break-all",
            fontFamily: "monospace",
          }}
        >
          {video.id}
        </code>
        <button
          type="button"
          onClick={copyUid}
          style={{
            background: "#E8A0A0",
            color: "#000",
            border: "none",
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "Georgia, serif",
            fontSize: "11px",
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p style={{ ...mutedItalic, fontSize: "11px", marginTop: "10px" }}>
        {video.attachedTo ? `→ ${video.attachedTo}` : "unassigned"}
      </p>
    </div>
  );
}

/** Provider timestamps are ISO strings; fall back to a label if absent/bad. */
function formatCreated(createdAt: string): string {
  if (!createdAt) return "Unknown date";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString();
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Minimal on-theme pulsing skeleton bar used in place of "Loading…" text. */
function SkeletonBar({ width = "140px" }: { width?: string }) {
  return (
    <div
      aria-hidden
      style={{
        width,
        height: "12px",
        borderRadius: "3px",
        background: "rgba(232,160,160,0.08)",
        animation: "dojoPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "4px",
  color: "#E8A0A0",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  marginBottom: "18px",
};

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(232,160,160,0.12)",
  background: "rgba(232,160,160,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};

const mutedItalic: React.CSSProperties = {
  fontSize: "13px",
  color: "rgba(245,240,240,0.45)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};

/** Same muted-italic voice, but tinted with the error rose to signal a failure. */
const errorItalic: React.CSSProperties = {
  ...mutedItalic,
  color: "#E8807A",
};
