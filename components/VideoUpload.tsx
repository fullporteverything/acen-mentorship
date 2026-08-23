"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as tus from "tus-js-client";
import {
  announceVideoUploaded,
  assignVideoToLesson,
  hasProcessingVideo,
  loadVideoLibrary,
  PROCESSING_POLL_MS,
  type VideoLibraryData,
} from "@/lib/video-library-client";

/**
 * Kinescope direct uploader (admin only).
 *
 * Flow: ask our server for a one-time tus endpoint, then push the file directly
 * to Kinescope. On success the returned video ID stays copyable for assignment,
 * and the same box carries the new row's live state plus the lesson picker — so
 * an upload can be bound to a lesson without scrolling down to the library.
 */
export default function VideoUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uid, setUid] = useState("");
  const [copied, setCopied] = useState(false);
  const [captionState, setCaptionState] = useState<"idle" | "requesting" | "queued" | "failed">("idle");
  // Library snapshot taken after the upload — supplies the row state shown in
  // the result box and the lessons offered by the picker below it.
  const [library, setLibrary] = useState<VideoLibraryData | null>(null);
  const [lessonId, setLessonId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState("");

  const row = library?.videos.find((video) => video.id === uid) ?? null;
  const lessons = library?.lessons ?? [];
  // Keep re-reading while the row is mid-transcode — and also while we have an
  // upload but no row yet, which covers a failed fetch or a list that hasn't
  // caught up. Once the row settles the polling stops on its own.
  const processing = uid !== "" && (row === null || hasProcessingVideo([row]));

  const refreshLibrary = useCallback(async () => {
    try {
      setLibrary(await loadVideoLibrary());
    } catch {
      // The ID above stays copyable, and the Video Library section below
      // carries its own retry — a failed status read is not worth an alarm.
    }
  }, []);

  // Transcoding finishes on Kinescope's clock, so re-read the row until it
  // settles rather than making the admin reload to find out.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void refreshLibrary(), PROCESSING_POLL_MS);
    return () => clearInterval(timer);
  }, [processing, refreshLibrary]);

  /**
   * tus errors stringify into a wall of request/response detail. Keep the first
   * line (and any HTTP status we can spot) so the admin sees something usable.
   */
  function readableError(err: unknown) {
    const raw =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    const firstLine = raw.split("\n")[0]?.trim() ?? "";
    const status = raw.match(/response code:? (\d{3})/i)?.[1];
    if (status) return `Upload failed (HTTP ${status}).`;
    if (!firstLine) return "Upload failed. Please try again.";
    return firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine;
  }

  /**
   * Accept a chosen or dropped file. Mirrors it into the hidden <input> so the
   * existing submit path (which reads inputRef.current.files) works unchanged
   * whether the file came from the picker or a drag-and-drop.
   */
  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Only video files are accepted.");
      return;
    }
    if (inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
    setError("");
    setFileName(file.name);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUid("");
    setCopied(false);
    setCaptionState("idle");
    setLibrary(null);
    setLessonId("");
    setAssignMessage("");

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a video to upload.");
      return;
    }
    if (!file.type.startsWith("video/")) {
      setError("Only video files are accepted.");
      return;
    }

    setStatus("uploading");
    setProgress(0);

    // 1) Initialize the one-time Kinescope tus upload URL server-side.
    let uploadUrl = "";
    let newUid = "";
    try {
      const res = await fetch("/api/admin/video-upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileSize: file.size, fileName: file.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.uploadUrl) {
        setError(data?.error || "Could not get an upload URL.");
        setStatus("idle");
        return;
      }
      uploadUrl = data.uploadUrl;
      newUid = data.videoId || "";
    } catch {
      setError("Could not get an upload URL.");
      setStatus("idle");
      return;
    }

    // 2) Push the bytes straight to Kinescope over tus.
    try {
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          // The URL is pre-created server-side, so point tus at it directly
          // instead of letting it create one via `endpoint`.
          uploadUrl,
          metadata: { name: file.name, filetype: file.type },
          onProgress: (bytesSent, bytesTotal) => {
            if (bytesTotal > 0) {
              setProgress(Math.round((bytesSent / bytesTotal) * 100));
            }
          },
          onSuccess: () => resolve(),
          onError: (err) => reject(err),
        });
        upload.start();
      });

      setUid(newUid);
      setStatus("done");
      setProgress(100);
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
      // Pull the row in for the panel below, and tell any library list on the
      // page to refetch so the new video shows up without a reload.
      void refreshLibrary();
      announceVideoUploaded(newUid);
      setCaptionState("requesting");
      fetch("/api/admin/video-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: newUid }),
      })
        .then((response) => setCaptionState(response.ok ? "queued" : "failed"))
        .catch(() => setCaptionState("failed"));
    } catch (err) {
      setError(readableError(err));
      setStatus("idle");
    }
  }

  async function copyUid() {
    try {
      await navigator.clipboard.writeText(uid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable; the ID is still visible to copy manually.
    }
  }

  /**
   * Same lesson-overrides write the library rows use. Assigning is allowed while
   * the video is still transcoding — the lesson simply stays "coming soon" until
   * Kinescope reports it playable, which saves a second trip to this page.
   */
  async function assign() {
    const lesson = lessons.find((item) => item.id === lessonId);
    if (!lesson) return;
    setAssigning(true);
    setAssignMessage("");
    try {
      setLibrary(await assignVideoToLesson(uid, lessonId));
      setAssignMessage(`Assigned to ${lesson.title}.`);
      // Same refetch signal — the library's copy of this row just changed too.
      announceVideoUploaded(uid);
    } catch (err) {
      setAssignMessage(
        err instanceof Error ? err.message : "Assignment failed — retry."
      );
    } finally {
      setAssigning(false);
    }
  }

  const uploading = status === "uploading";
  const rowState = !row
    ? "Reading status…"
    : row.error
      ? "Processing failed"
      : row.ready
        ? "Ready to assign"
        : `Processing${row.progress !== null ? ` · ${Math.round(row.progress)}%` : ""}`;

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Upload Video</p>

      <form onSubmit={handleSubmit} style={{ maxWidth: "520px" }}>
        <label
          onDragOver={(e) => {
            if (uploading) return;
            e.preventDefault();
            if (!dragActive) setDragActive(true);
          }}
          onDragEnter={(e) => {
            if (uploading) return;
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (uploading) return;
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          style={{
            display: "block",
            textAlign: "center",
            border: `1px dashed ${dragActive ? "rgba(231,192,113,0.75)" : "rgba(231,192,113,0.3)"}`,
            background: dragActive ? "rgba(231,192,113,0.10)" : "rgba(231,192,113,0.03)",
            padding: "26px 20px",
            cursor: uploading ? "default" : "pointer",
            fontFamily: "Georgia, serif",
            marginBottom: "10px",
            transition: "border-color 0.15s ease, background 0.15s ease",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            onChange={(e) => acceptFile(e.target.files?.[0])}
            disabled={uploading}
            style={{ display: "none" }}
          />
          <span
            style={{
              display: "block",
              fontSize: "13px",
              color: fileName ? "#F5F0F0" : "rgba(245,240,240,0.5)",
            }}
          >
            {fileName || (dragActive ? "Drop the video to upload" : "Choose a video file…")}
          </span>
          {!fileName && (
            <span
              style={{
                display: "block",
                marginTop: "6px",
                fontSize: "10px",
                letterSpacing: "2px",
                textTransform: "uppercase",
                color: "rgba(231,192,113,0.55)",
              }}
            >
              or drag &amp; drop here
            </span>
          )}
        </label>

        <p
          style={{
            fontSize: "10px",
            color: "rgba(245,240,240,0.35)",
            fontFamily: "Georgia, serif",
            letterSpacing: "1px",
            marginBottom: "18px",
          }}
        >
          Uploads directly to Kinescope. Large files are supported and uploads
          are resumable.
        </p>

        {uploading && (
          <div style={{ marginBottom: "18px" }}>
            <div
              style={{
                height: "2px",
                width: "100%",
                background: "rgba(231,192,113,0.15)",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "#e3c071",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
            <p
              style={{
                fontSize: "11px",
                color: "rgba(245,240,240,0.55)",
                fontFamily: "Georgia, serif",
                letterSpacing: "1px",
              }}
            >
              Uploading… {progress}%
            </p>
          </div>
        )}

        {error && (
          <p
            style={{
              fontSize: "12px",
              color: "#E8807A",
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              marginBottom: "16px",
            }}
          >
            {error}
          </p>
        )}

        {uid && (
          <div
            style={{
              border: "1px solid rgba(231,192,113,0.25)",
              background: "rgba(0,0,0,0.3)",
              padding: "16px 18px",
              marginBottom: "18px",
            }}
          >
            <p
              style={{
                fontSize: "10px",
                letterSpacing: "3px",
                color: "rgba(231,192,113,0.7)",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
                marginBottom: "10px",
              }}
            >
              Kinescope Video ID
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
                  fontSize: "13px",
                  color: "#F5F0F0",
                  wordBreak: "break-all",
                  fontFamily: "monospace",
                }}
              >
                {uid}
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
            <p style={{ marginTop: "12px" }}>
              <span style={tinyLabel}>State</span>
              <span
                className={`video-state ${
                  row?.error ? "error" : row?.ready ? "ready" : "processing"
                }`}
              >
                {rowState}
              </span>
            </p>
            {processing && (
              <p style={{ ...uploadNote, marginTop: "8px" }}>
                Processing — refreshes automatically
              </p>
            )}
            <p
              style={{
                fontSize: "10px",
                letterSpacing: "1px",
                color: "rgba(231,192,113,0.7)",
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                marginTop: "8px",
              }}
            >
              {captionState === "queued"
                ? "English captions queued automatically."
                : captionState === "failed"
                  ? "Video is safe; captions could not be queued yet. Retry from Kinescope."
                  : "Requesting automatic English captions…"}
            </p>

            {/* Assign right here — no need to scroll to the library below. */}
            <div
              style={{
                marginTop: "16px",
                paddingTop: "16px",
                borderTop: "1px solid rgba(231,192,113,0.15)",
              }}
            >
              <p style={{ ...tinyLabel, display: "block", marginBottom: "10px" }}>
                Assign to lesson
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <select
                  value={lessonId}
                  onChange={(event) => setLessonId(event.target.value)}
                  disabled={!library || assigning}
                  aria-label="Assign the uploaded video to a lesson"
                  style={{
                    minWidth: "220px",
                    padding: "8px 10px",
                    background: "#080606",
                    color: "#F5F0F0",
                    border: "1px solid rgba(231,192,113,0.25)",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  <option value="">
                    {library ? "Choose lesson…" : "Loading lessons…"}
                  </option>
                  {lessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>
                      {lesson.title}
                      {lesson.videoId ? " · has video" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={assign}
                  disabled={!lessonId || assigning}
                  style={{
                    ...secondaryButton,
                    opacity: !lessonId || assigning ? 0.45 : 1,
                  }}
                >
                  {assigning ? "Assigning…" : "Assign to lesson"}
                </button>
              </div>
              {assignMessage && (
                <p style={{ ...uploadNote, marginTop: "9px" }}>{assignMessage}</p>
              )}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={uploading}
          style={{
            background: "#e3c071",
            color: "#000",
            border: "none",
            padding: "8px 16px",
            cursor: uploading ? "default" : "pointer",
            fontFamily: "Georgia, serif",
            fontSize: "12px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          {uploading ? "Uploading…" : "Upload to Kinescope"}
        </button>
      </form>
    </section>
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

const tinyLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "3px",
  color: "rgba(231,192,113,0.7)",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
};

const uploadNote: React.CSSProperties = {
  fontSize: "11px",
  color: "rgba(245,240,240,0.5)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};

/** Matches the quiet action buttons on the library rows below. */
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

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(231,192,113,0.12)",
  background: "rgba(231,192,113,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};
