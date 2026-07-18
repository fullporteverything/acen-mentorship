"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface HomeworkUploadProps {
  lessonId: string;
}

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Homework PDF uploader. Posts multipart FormData to
 * `/api/lessons/submit-homework`, then refreshes the server component so the
 * new submission + (possibly auto-approved) unlock state render.
 */
export default function HomeworkUpload({ lessonId }: HomeworkUploadProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "uploading">("idle");
  const [error, setError] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Please choose a PDF to upload.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("Only PDF files are accepted.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File is too large. Max 20MB.");
      return;
    }

    setStatus("uploading");
    try {
      const body = new FormData();
      body.append("lessonId", lessonId);
      body.append("file", file);

      const res = await fetch("/api/lessons/submit-homework", {
        method: "POST",
        body,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Upload failed. Please try again.");
        setStatus("idle");
        return;
      }

      // Reset and refresh to pick up the new submission / unlock state.
      setFileName("");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  const uploading = status === "uploading";

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: "520px" }}>
      <p
        style={{
          fontSize: "12px",
          letterSpacing: "2px",
          color: "rgba(245,240,240,0.6)",
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
          marginBottom: "12px",
        }}
      >
        Upload your homework (PDF)
      </p>

      <label
        style={{
          display: "block",
          border: "1px dashed rgba(232,160,160,0.3)",
          background: "rgba(232,160,160,0.03)",
          padding: "18px 20px",
          cursor: "pointer",
          fontFamily: "Georgia, serif",
          marginBottom: "10px",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
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
          {fileName || "Choose a PDF file…"}
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
        PDF files only. Max 20MB.
      </p>

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

      <button
        type="submit"
        disabled={uploading}
        className="btn-discord"
        style={{ opacity: uploading ? 0.6 : 1 }}
      >
        {uploading ? "Submitting…" : "Submit Homework"}
      </button>
    </form>
  );
}
