"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type AsTag = "h1" | "h2" | "p" | "span";

interface EditableTextProps {
  value: string;
  lessonId: string;
  field: string;
  isAdmin: boolean;
  className?: string;
  style?: React.CSSProperties;
  as?: AsTag;
}

/**
 * Inline-editable text. For admins, double-clicking swaps the rendered text
 * for an input (titles) or textarea (longer copy) pre-filled with the current
 * value; blur or Enter (single-line) persists it via /api/admin/lesson-overrides
 * and refreshes the server component so the new value renders. For everyone
 * else it renders the text unchanged.
 */
export default function EditableText({
  value,
  lessonId,
  field,
  isAdmin,
  className,
  style,
  as = "span",
}: EditableTextProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  // Titles edit as a single-line input; everything else as a textarea.
  const multiline = field !== "title";

  // Keep the draft in sync if the underlying value changes (e.g. after refresh).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const Tag = as;

  if (!isAdmin) {
    return (
      <Tag className={className} style={style}>
        {value}
      </Tag>
    );
  }

  async function save() {
    setEditing(false);
    const next = draft;
    if (next === value) return; // nothing changed
    setSaving(true);
    try {
      await fetch("/api/admin/lesson-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, field, value: next }),
      });
      router.refresh();
    } catch {
      // On failure, restore the last-known value.
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      save();
    } else if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    const editorStyle: React.CSSProperties = {
      ...style,
      width: "100%",
      background: "rgba(0,0,0,0.4)",
      border: "1px solid rgba(232,160,160,0.4)",
      color: "#F5F0F0",
      fontFamily: "Georgia, serif",
      padding: "6px 10px",
      outline: "none",
      resize: multiline ? "vertical" : "none",
    };

    return multiline ? (
      <textarea
        ref={inputRef}
        value={draft}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        style={editorStyle}
      />
    ) : (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        style={editorStyle}
      />
    );
  }

  return (
    <Tag
      className={`editable-admin${className ? ` ${className}` : ""}`}
      style={style}
      onDoubleClick={() => setEditing(true)}
      title="Double-click to edit"
    >
      {saving ? draft : value}
    </Tag>
  );
}
