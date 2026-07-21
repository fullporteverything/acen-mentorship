"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SectionAdminControlsProps {
  /** The section (group) name these controls act on. */
  section: string;
}

type Mode = "idle" | "renaming" | "confirmDelete";

/**
 * Admin-only inline control row for a section header: rename and delete.
 *
 * Rename opens an inline text input (prefilled with the current name) that
 * PATCHes /api/admin/section and refreshes. Delete asks for inline confirmation
 * first; if the section holds lessons the API returns `requiresForce`, and a
 * second confirmation resends with `force: true`. API error strings surface
 * inline in the muted-italic error style. Sections with built-in lessons are
 * refused server-side, and that error is shown here.
 */
export default function SectionAdminControls({
  section,
}: SectionAdminControlsProps) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState(section);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forceDelete, setForceDelete] = useState(false);
  const [confirmLabel, setConfirmLabel] = useState("Delete section?");

  function resetRename() {
    setName(section);
    setError("");
    setMode("idle");
  }

  function resetDelete() {
    setError("");
    setForceDelete(false);
    setConfirmLabel("Delete section?");
    setMode("idle");
  }

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const to = name.trim();
    if (!to) {
      setError("A new section name is required.");
      return;
    }
    if (to === section) {
      resetRename();
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/section", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: section, to }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not rename the section.");
        setBusy(false);
        return;
      }
      setMode("idle");
      router.refresh();
    } catch {
      setError("Could not rename the section.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/section", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, force: forceDelete }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data?.requiresForce) {
          // Section holds lessons — escalate to a force-confirm step.
          setForceDelete(true);
          setConfirmLabel(data?.error || "Delete anyway?");
          setError("");
          setBusy(false);
          return;
        }
        setError(data?.error || "Could not delete the section.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not delete the section.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={rowStyle}>
      {mode === "renaming" ? (
        <form onSubmit={saveRename} style={formStyle}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Section name"
            autoFocus
            style={inputStyle}
          />
          <button type="submit" disabled={busy} style={actionStyle}>
            {busy ? "…" : "save"}
          </button>
          <button
            type="button"
            onClick={resetRename}
            disabled={busy}
            style={mutedActionStyle}
          >
            cancel
          </button>
        </form>
      ) : mode === "confirmDelete" ? (
        <div style={formStyle}>
          <span style={confirmStyle}>{confirmLabel}</span>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy}
            style={actionStyle}
          >
            {busy ? "…" : forceDelete ? "delete anyway" : "yes"}
          </button>
          <button
            type="button"
            onClick={resetDelete}
            disabled={busy}
            style={mutedActionStyle}
          >
            no
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setError("");
              setMode("renaming");
            }}
            style={actionStyle}
          >
            rename
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setMode("confirmDelete");
            }}
            style={actionStyle}
          >
            delete
          </button>
        </>
      )}

      {error && <p style={errorStyle}>{error}</p>}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px",
  padding: "6px 28px 8px",
};

const formStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "8px",
  width: "100%",
};

const actionStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "#E8A0A0",
  fontFamily: "Georgia, serif",
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
};

const mutedActionStyle: React.CSSProperties = {
  ...actionStyle,
  color: "rgba(245,240,240,0.5)",
};

const confirmStyle: React.CSSProperties = {
  color: "rgba(245,240,240,0.6)",
  fontFamily: "Georgia, serif",
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  flex: "1 1 120px",
  minWidth: 0,
  padding: "6px 8px",
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(232,160,160,0.2)",
  color: "#F5F0F0",
  fontFamily: "Georgia, serif",
  fontSize: "11px",
  outline: "none",
  boxSizing: "border-box",
};

const errorStyle: React.CSSProperties = {
  width: "100%",
  margin: 0,
  color: "#E8807A",
  fontFamily: "Georgia, serif",
  fontSize: "10px",
  fontStyle: "italic",
};
