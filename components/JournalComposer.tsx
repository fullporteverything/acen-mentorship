"use client";

import { useState, useTransition } from "react";

const MAX = 5000;

/**
 * Composer for a new Journal entry — client component so the "n / 5000" char
 * counter stays live. Delegates persistence to the server action passed in as
 * `action`, then clears itself on success.
 */
export default function JournalComposer({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  const count = value.length;
  const over = count > MAX;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!value.trim() || over) return;
    const fd = new FormData();
    fd.set("body", value);
    startTransition(async () => {
      await action(fd);
      setValue("");
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ maxWidth: 900, margin: "0 auto" }}>
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
          rows={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "vertical",
            minHeight: 180,
            padding: "20px 22px",
            color: "#F5F0F0",
            fontFamily: "Georgia, serif",
            fontSize: 15,
            lineHeight: 1.8,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: 8,
          fontSize: 11,
          letterSpacing: 1,
          fontFamily: "Georgia, serif",
          color: over ? "#E8807A" : "rgba(245,240,240,0.4)",
        }}
      >
        {count} / {MAX}
      </div>

      <div style={{ marginTop: 18 }}>
        <button
          type="submit"
          disabled={pending || !value.trim() || over}
          className="btn-discord"
          style={{
            padding: "12px 32px",
            opacity: pending || !value.trim() || over ? 0.45 : 1,
          }}
        >
          {pending ? "Posting…" : "Post Entry"}
        </button>
      </div>
    </form>
  );
}
