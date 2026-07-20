"use client";

import { useRef, useState, useTransition } from "react";

const MAX = 5000;
const MAX_IMAGES = 4;
const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8MB

type Preview = { file: File; url: string };

/**
 * Composer for a new Journal entry — client component so the "n / 5000" char
 * counter + image previews stay live. Sends body text and up to 4 trade
 * screenshots as multipart FormData to the server action, then clears itself.
 */
export default function JournalComposer({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const count = value.length;
  const over = count > MAX;
  const canPost = (value.trim().length > 0 || previews.length > 0) && !over;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    setPreviews((current) => {
      const next = [...current];
      for (const f of Array.from(list)) {
        if (!f.type.startsWith("image/")) {
          setError("Only image files.");
          continue;
        }
        if (f.size > MAX_IMG_BYTES) {
          setError("Each image must be under 8MB.");
          continue;
        }
        if (next.length >= MAX_IMAGES) {
          setError(`Up to ${MAX_IMAGES} screenshots.`);
          break;
        }
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      return next;
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeImage(i: number) {
    setPreviews((current) => {
      const p = current[i];
      if (p) URL.revokeObjectURL(p.url);
      return current.filter((_, idx) => idx !== i);
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canPost) return;
    const fd = new FormData();
    fd.set("body", value);
    for (const p of previews) fd.append("images", p.file);
    startTransition(async () => {
      await action(fd);
      previews.forEach((p) => URL.revokeObjectURL(p.url));
      setPreviews([]);
      setValue("");
      setError("");
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          position: "relative",
          border: "1px solid rgba(232,160,160,0.18)",
          background: "rgba(0,0,0,0.55)",
        }}
      >
        <textarea
          name="body"
          placeholder="Write your thoughts, progress, questions..."
          rows={6}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "vertical",
            minHeight: 144,
            padding: "16px 18px",
            color: "#F5F0F0",
            fontFamily: "Georgia, serif",
            fontSize: 12,
            lineHeight: 1.8,
          }}
        />
      </div>

      {/* Image previews */}
      {previews.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {previews.map((p, i) => (
            <div
              key={p.url}
              style={{
                position: "relative",
                width: 76,
                height: 76,
                border: "1px solid rgba(232,160,160,0.2)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt="screenshot preview"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                aria-label="Remove image"
                style={{
                  position: "absolute",
                  top: -8,
                  right: -8,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "1px solid rgba(232,160,160,0.5)",
                  background: "#000",
                  color: "#E8A0A0",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 10,
        }}
      >
        <label
          style={{
            fontSize: 9,
            letterSpacing: 2,
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            color: previews.length >= MAX_IMAGES ? "rgba(245,240,240,0.3)" : "#E8A0A0",
            cursor: previews.length >= MAX_IMAGES ? "default" : "pointer",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={pending || previews.length >= MAX_IMAGES}
            onChange={(e) => addFiles(e.target.files)}
            style={{ display: "none" }}
          />
          + Add screenshots ({previews.length}/{MAX_IMAGES})
        </label>

        <span
          style={{
            fontSize: 9,
            letterSpacing: 1,
            fontFamily: "Georgia, serif",
            color: over ? "#E8807A" : "rgba(245,240,240,0.4)",
          }}
        >
          {count} / {MAX}
        </span>
      </div>

      {error && (
        <p
          style={{
            fontSize: 10,
            color: "#E8807A",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            marginTop: 8,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        <button
          type="submit"
          disabled={pending || !canPost}
          className="btn-discord"
          style={{
            padding: "10px 26px",
            fontSize: 11,
            opacity: pending || !canPost ? 0.45 : 1,
          }}
        >
          {pending ? "Posting…" : "Post Entry"}
        </button>
      </div>
    </form>
  );
}
