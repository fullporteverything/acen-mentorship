"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Kebab, { type KebabItem } from "@/components/Kebab";

interface LessonAdminMenuProps {
  lessonId: string;
  title: string;
  /** Raw section/group name — the reorder endpoint normalizes it. */
  group: string;
  /** Ordered lesson ids of this lesson's section, as currently rendered. */
  sectionIds: string[];
  /**
   * True only for admin-added lessons — static/built-in lessons can be
   * reordered but never deleted, so their menu omits the Delete item.
   */
  canDelete: boolean;
}

/**
 * Compact per-lesson kebab for admins, revealed on row hover (parent uses
 * `.kebab-visible-on-hover`). Move up/down persist the FULL section order via
 * POST /api/admin/lesson-order (exact-set validated server-side) and refresh;
 * Delete (admin-added lessons only) flips to a two-step inline confirm before
 * calling DELETE /api/admin/lesson.
 */
export default function LessonAdminMenu({
  lessonId,
  title,
  group,
  sectionIds,
  canDelete,
}: LessonAdminMenuProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const index = sectionIds.indexOf(lessonId);
  const canMoveUp = index > 0;
  const canMoveDown = index >= 0 && index < sectionIds.length - 1;

  async function move(direction: -1 | 1) {
    if (busy || index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= sectionIds.length) return;
    const next = [...sectionIds];
    [next[index], next[target]] = [next[target], next[index]];

    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/lesson-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group, lessonIds: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not save the new order.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not save the new order.");
    } finally {
      setBusy(false);
    }
  }

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
        <span style={confirmTextStyle}>Delete?</span>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            doDelete();
          }}
          style={{ ...confirmButtonStyle, color: "#E8807A" }}
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
          style={{ ...confirmButtonStyle, color: "rgba(245,240,240,0.5)" }}
        >
          no
        </button>
      </div>
    );
  }

  const items: KebabItem[] = [
    {
      label: busy ? "Saving…" : "Move up",
      disabled: busy || !canMoveUp,
      onSelect: () => move(-1),
    },
    {
      label: busy ? "Saving…" : "Move down",
      disabled: busy || !canMoveDown,
      onSelect: () => move(1),
    },
  ];
  if (canDelete) {
    items.push({
      label: "Delete lesson",
      danger: true,
      disabled: busy,
      onSelect: () => setConfirming(true),
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {error && (
        <span
          style={{
            fontSize: 9,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            color: "#E8807A",
            whiteSpace: "nowrap",
          }}
        >
          {error}
        </span>
      )}
      <Kebab ariaLabel={`Options for ${title}`} items={items} />
    </span>
  );
}

const confirmTextStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 2,
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  color: "rgba(245,240,240,0.65)",
};

const confirmButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontFamily: "Georgia, serif",
  fontSize: 9,
  letterSpacing: 2,
  textTransform: "uppercase",
  cursor: "pointer",
};
