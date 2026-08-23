"use client";

import { useCallback, useEffect, useState } from "react";
import {
  assignVideoToLesson,
  hasProcessingVideo,
  loadVideoLibrary,
  PROCESSING_POLL_MS,
  VIDEO_UPLOADED_EVENT,
  type AssignableLesson,
  type LibraryVideo,
  type VideoLibraryData,
} from "@/lib/video-library-client";
import RetryButton from "@/components/RetryButton";

/**
 * Persistent list of every video in the Kinescope project.
 *
 * VideoUpload only shows an ID for the video you just uploaded, and only until
 * the page reloads. This section is the permanent record: every ID stays
 * copyable forever, alongside which lesson it's attached to (if any).
 */
export default function VideoLibrary() {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [lessons, setLessons] = useState<AssignableLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await loadVideoLibrary();
      setVideos(data.videos);
      setLessons(data.lessons);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Background re-read: no skeleton, and a failure leaves the last good rows in
   * place rather than replacing the whole list with an error the admin didn't ask
   * for. The next poll (or the retry button) recovers.
   */
  const refresh = useCallback(async () => {
    try {
      const data = await loadVideoLibrary();
      setVideos(data.videos);
      setLessons(data.lessons);
    } catch {
      // Keep showing what we have; the next tick tries again.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // An upload elsewhere on the page adds a row we don't know about yet.
  useEffect(() => {
    const onUploaded = () => void refresh();
    window.addEventListener(VIDEO_UPLOADED_EVENT, onUploaded);
    return () => window.removeEventListener(VIDEO_UPLOADED_EVENT, onUploaded);
  }, [refresh]);

  // Rows Kinescope is still transcoding change without us doing anything, so
  // poll until every one of them has settled — then stop.
  const processing = hasProcessingVideo(videos);
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void refresh(), PROCESSING_POLL_MS);
    return () => clearInterval(timer);
  }, [processing, refresh]);

  function reconcile(data: VideoLibraryData) {
    setVideos(data.videos);
    setLessons(data.lessons);
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Video Library</p>
      {loading ? (
        <SkeletonBar width="200px" />
      ) : error ? (
        <div className="state-message state-message-error">
          <p>Couldn&apos;t load videos.</p>
          <RetryButton onRetry={load} />
        </div>
      ) : videos.length === 0 ? (
        <div className="state-message"><p>No videos uploaded yet.</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {videos.map((video) => (
            <VideoRow
              key={video.id}
              video={video}
              lessons={lessons}
              onAssigned={reconcile}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function VideoRow({
  video,
  lessons,
  onAssigned,
}: {
  video: LibraryVideo;
  lessons: AssignableLesson[];
  onAssigned: (data: VideoLibraryData) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [lessonId, setLessonId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [captioning, setCaptioning] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const processing = hasProcessingVideo([video]);
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

  async function assignVideo() {
    const lesson = lessons.find((item) => item.id === lessonId);
    if (!lesson) return;
    setAssigning(true);
    setActionMessage("");
    try {
      const data = await assignVideoToLesson(video.id, lessonId);
      onAssigned(data);
      setActionMessage(`Assigned to ${lesson.title}.`);
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Assignment failed — retry."
      );
    } finally {
      setAssigning(false);
    }
  }

  async function retryCaptions() {
    setCaptioning(true);
    setActionMessage("");
    try {
      const response = await fetch("/api/admin/video-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Caption request failed.");
      setActionMessage("English captions queued.");
    } catch (error) {
      setActionMessage(
        error instanceof Error ? error.message : "Caption request failed — retry."
      );
    } finally {
      setCaptioning(false);
    }
  }

  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid rgba(231,192,113,0.10)",
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
          <span style={{ color: "rgba(231,192,113,0.7)", fontStyle: "italic" }}>
            {" "}· {video.status}
            {video.progress !== null ? ` (${Math.round(video.progress)}%)` : ""}
          </span>
        ) : null}
      </p>
      {processing && (
        <p style={{ ...mutedItalic, fontSize: "11px", marginBottom: "10px" }}>
          Processing — refreshes automatically
        </p>
      )}
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
            background: "#e3c071",
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
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: "12px",
        }}
      >
        <select
          value={lessonId}
          onChange={(event) => setLessonId(event.target.value)}
          aria-label={`Assign ${video.title} to lesson`}
          style={{
            minWidth: "220px",
            padding: "8px 10px",
            background: "#080606",
            color: "#F5F0F0",
            border: "1px solid rgba(231,192,113,0.25)",
            fontFamily: "Georgia, serif",
          }}
        >
          <option value="">Choose lesson…</option>
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {lesson.title}{lesson.videoId ? " · has video" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={assignVideo}
          disabled={!video.ready || !lessonId || assigning}
          style={{ ...secondaryButton, opacity: !video.ready || !lessonId ? 0.45 : 1 }}
        >
          {assigning ? "Assigning…" : "Assign to lesson"}
        </button>
        <button
          type="button"
          onClick={retryCaptions}
          disabled={!video.ready || captioning}
          style={{ ...secondaryButton, opacity: !video.ready ? 0.45 : 1 }}
        >
          {captioning ? "Queuing…" : "Generate / retry captions"}
        </button>
      </div>
      {actionMessage && (
        <p style={{ ...mutedItalic, fontSize: "11px", marginTop: "9px" }}>
          {actionMessage}
        </p>
      )}
    </div>
  );
}

const secondaryButton: React.CSSProperties = {
  padding: "8px 12px",
  background: "transparent",
  color: "#e3c071",
  border: "1px solid rgba(231,192,113,0.35)",
  fontFamily: "Georgia, serif",
  fontSize: "9px",
  letterSpacing: "1px",
  textTransform: "uppercase",
  cursor: "pointer",
};

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
        background: "rgba(231,192,113,0.08)",
        animation: "dojoPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "4px",
  color: "#e3c071",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  marginBottom: "18px",
};

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(231,192,113,0.12)",
  background: "rgba(231,192,113,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};

const mutedItalic: React.CSSProperties = {
  fontSize: "13px",
  color: "rgba(245,240,240,0.58)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};
