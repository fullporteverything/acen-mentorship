"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AddLessonFormProps {
  /**
   * When set, new lessons are added to this existing section and the section
   * field is hidden ("+ Add Lesson" mode). When omitted, the admin types a new
   * section name ("+ Add Section" mode).
   */
  section?: string;
  /** Button label. Defaults based on mode. */
  label?: string;
}

/**
 * Admin-only collapsible form to append a lesson (and, in add-section mode, a
 * new section) to the curriculum. Posts to /api/admin/add-lesson and refreshes.
 */
export default function AddLessonForm({ section, label }: AddLessonFormProps) {
  const router = useRouter();
  const addSectionMode = section === undefined;

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [description, setDescription] = useState("");
  const [homeworkPrompt, setHomeworkPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const buttonLabel = label || (addSectionMode ? "+ Add Section" : "+ Add Lesson");

  function reset() {
    setTitle("");
    setSectionName("");
    setDescription("");
    setHomeworkPrompt("");
    setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const targetSection = addSectionMode ? sectionName.trim() : section;
    if (addSectionMode) {
      // Section name is required; the first lesson is optional (add it later).
      if (!targetSection) {
        setError("A section name is required.");
        return;
      }
    } else if (!title.trim()) {
      setError("A lesson title is required.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/add-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          section: targetSection,
          homeworkPrompt: homeworkPrompt.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not add the lesson.");
        setSaving(false);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not add the lesson.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={triggerStyle}
      >
        {buttonLabel}
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={formStyle}>
      {addSectionMode && (
        <input
          type="text"
          placeholder="Section name"
          value={sectionName}
          onChange={(e) => setSectionName(e.target.value)}
          style={inputStyle}
        />
      )}
      <input
        type="text"
        placeholder={
          addSectionMode ? "Lesson title (optional — add later)" : "Lesson title"
        }
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={inputStyle}
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <textarea
        placeholder="Homework prompt (optional)"
        value={homeworkPrompt}
        onChange={(e) => setHomeworkPrompt(e.target.value)}
        rows={2}
        style={{ ...inputStyle, resize: "vertical" }}
      />

      {error && (
        <p
          style={{
            fontSize: "11px",
            color: "#E8807A",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="submit"
          disabled={saving}
          style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={saving}
          style={cancelBtn}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const triggerStyle: React.CSSProperties = {
  display: "block",
  width: "calc(100% - 56px)",
  margin: "8px 28px",
  padding: "8px 12px",
  background: "transparent",
  border: "1px dashed rgba(232,160,160,0.35)",
  color: "#E8A0A0",
  fontFamily: "Georgia, serif",
  fontSize: "10px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
  textAlign: "left",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  margin: "8px 28px",
  padding: "14px",
  border: "1px solid rgba(232,160,160,0.2)",
  background: "rgba(0,0,0,0.35)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(232,160,160,0.2)",
  color: "#F5F0F0",
  fontFamily: "Georgia, serif",
  fontSize: "12px",
  outline: "none",
  boxSizing: "border-box",
};

const primaryBtn: React.CSSProperties = {
  background: "#E8A0A0",
  color: "#000",
  border: "none",
  padding: "8px 16px",
  cursor: "pointer",
  fontFamily: "Georgia, serif",
  fontSize: "10px",
  letterSpacing: "2px",
  textTransform: "uppercase",
};

const cancelBtn: React.CSSProperties = {
  background: "transparent",
  color: "rgba(245,240,240,0.5)",
  border: "1px solid rgba(232,160,160,0.2)",
  padding: "8px 16px",
  cursor: "pointer",
  fontFamily: "Georgia, serif",
  fontSize: "10px",
  letterSpacing: "2px",
  textTransform: "uppercase",
};
