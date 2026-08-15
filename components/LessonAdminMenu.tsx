"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Kebab from "@/components/Kebab";

interface LessonAdminMenuProps {
  lessonId: string;
  title: string;
  /**
   * True only for admin-added lessons. Static/built-in lessons don't render
   * this component at all (nothing to delete for them), but the flag guards
   * against any callers wiring it up by mistake.
   */
  canDelete: boolean;
}

/**
 * Compact per-lesson kebab for admins. Sits inside the lesson row, hidden by
 * default and revealed only on hover of the row (parent uses
 * `.kebab-visible-on-hover` — see globals.css). One menu item: Delete, which
 * flips to a two-step confirm before actually calling DELETE /api/admin/lesson.
 */
export default function LessonAdminMenu({
  lessonId,
  title,
  canDelete,
}: LessonAdminMenuProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function doDelete() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/lesson", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lessonId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not delete the lesson.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not delete the lesson.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 6px",
          background: "rgba(232,80,80,0.10)",
          border: "1px solid rgba(232,128,122,0.45)",
          borderRadius: 3,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: 2,
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            color: "rgba(245,240,240,0.65)",
          }}
        >
          Delete?
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            doDelete();
          }}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            fontFamily: "Georgia, serif",
            fontSize: 9,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#E8807A",
            cursor: "pointer",
          }}
        >
          {busy ? "…" : "yes"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirming(false);
            setError("");
          }}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            fontFamily: "Georgia, serif",
            fontSize: 9,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "rgba(245,240,240,0.5)",
            cursor: "pointer",
          }}
        >
          no
        </button>
        {error && (
          <span
            style={{
              fontSize: 9,
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

  return (
    <Kebab
      ariaLabel={`Options for ${title}`}
      items={[
        {
          label: "Delete lesson",
          danger: true,
          disabled: !canDelete,
          onSelect: () => setConfirming(true),
        },
      ]}
    />
  );
}
