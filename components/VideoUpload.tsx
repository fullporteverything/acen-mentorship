"use client";

import { useRef, useState } from "react";

/**
 * Cloudflare Stream direct-creator uploader (admin only).
 *
 * Flow: ask our server for a one-time `uploadURL` + `uid`, then POST the file
 * straight to Cloudflare via XMLHttpRequest so we get real upload progress
 * (fetch can't report upload progress). On success the returned video UID is
 * shown with a copy button — the admin pastes it into `lib/lessons-config.ts`
 * (the `videoId` of a lesson).
 */
export default function VideoUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uid, setUid] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUid("");
    setCopied(false);

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

    // 1) Mint the one-time direct-upload URL.
    let uploadURL = "";
    let newUid = "";
    try {
      const res = await fetch("/api/admin/stream-upload-url", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.uploadURL) {
        setError(data?.error || "Could not get an upload URL.");
        setStatus("idle");
        return;
      }
      uploadURL = data.uploadURL;
      newUid = data.uid || "";
    } catch {
      setError("Could not get an upload URL.");
      setStatus("idle");
      return;
    }

    // 2) Upload the bytes directly to Cloudflare with progress.
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadURL);
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));

        const formData = new FormData();
        formData.append("file", file);
        xhr.send(formData);
      });

      setUid(newUid);
      setStatus("done");
      setProgress(100);
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Upload failed. Please try again."
      );
      setStatus("idle");
    }
  }

  async function copyUid() {
    try {
      await navigator.clipboard.writeText(uid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable; the UID is still visible to copy manually.
    }
  }

  const uploading = status === "uploading";

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Upload Video</p>

      <form onSubmit={handleSubmit} style={{ maxWidth: "520px" }}>
        <label
          style={{
            display: "block",
            border: "1px dashed rgba(232,160,160,0.3)",
            background: "rgba(232,160,160,0.03)",
            padding: "18px 20px",
            cursor: uploading ? "default" : "pointer",
            fontFamily: "Georgia, serif",
            marginBottom: "10px",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
            disabled={uploading}
            style={{ display: "none" }}
          />
          <span
            style={{
              fontSize: "13px",
              color: fileName ? "#F5F0F0" : "rgba(245,240,240,0.5)",
            }}
          >
            {fileName || "Choose a video file…"}
          </span>
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
          Uploads directly to Cloudflare Stream. Max duration 2 hours.
        </p>

        {uploading && (
          <div style={{ marginBottom: "18px" }}>
            <div
              style={{
                height: "2px",
                width: "100%",
                background: "rgba(232,160,160,0.15)",
                marginBottom: "8px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "#E8A0A0",
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
              border: "1px solid rgba(232,160,160,0.25)",
              background: "rgba(0,0,0,0.3)",
              padding: "16px 18px",
              marginBottom: "18px",
            }}
          >
            <p
              style={{
                fontSize: "10px",
                letterSpacing: "3px",
                color: "rgba(232,160,160,0.7)",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
                marginBottom: "10px",
              }}
            >
              Video UID
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
            <p
              style={{
                fontSize: "11px",
                color: "rgba(245,240,240,0.45)",
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                marginTop: "10px",
                lineHeight: 1.7,
              }}
            >
              Paste this into a lesson&rsquo;s <code>videoId</code> in
              lib/lessons-config.ts.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={uploading}
          style={{
            background: "#E8A0A0",
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
          {uploading ? "Uploading…" : "Upload to Cloudflare"}
        </button>
      </form>
    </section>
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
