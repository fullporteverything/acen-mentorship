"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Kebab from "@/components/Kebab";

interface SectionAdminControlsProps {
  /** The section (group) name these controls act on. */
  section: string;
  /**
   * Sections holding built-in lessons can't be renamed (their group name
   * lives in code), so the Rename item is withheld for them. Delete works
   * on every section — built-in lessons get hidden server-side.
   */
  canRename?: boolean;
}

type Mode = "idle" | "renaming" | "confirmDelete";

/**
 * Admin-only compact controls for a section header — surfaces a three-dot
 * kebab menu with Rename / Delete. The trigger stays hidden until the section
 * header row is hovered (parent adds .kebab-visible-on-hover), so the sidebar
 * stays clean for members and for admins who aren't currently editing.
 *
 * Rename swaps in an inline text input. Delete asks inline first; if the
 * section still holds lessons the server returns `requiresForce` and a
 * second confirmation resends with `force: true` (admin-added lessons are
 * removed; built-in lessons are hidden, preserving progress on their ids).
 */
export default function SectionAdminControls({
  section,
  canRename = true,
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

  // Idle: just the kebab menu tucked to the right of the section header.
  if (mode === "idle") {
    return (
      <Kebab
        ariaLabel={`Options for ${section}`}
        items={[
          ...(canRename
            ? [{ label: "Rename", onSelect: () => setMode("renaming") }]
            : []),
          {
            label: "Delete",
            danger: true,
            onSelect: () => setMode("confirmDelete"),
          },
        ]}
      />
    );
  }

  // Rename + confirmDelete render an inline strip *below* the header row so
  // the row itself stays visually intact.
  return (
    <div style={inlineStripStyle}>
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
      ) : (
        <div style={formStyle}>
          <span style={confirmStyle}>{confirmLabel}</span>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy}
            style={dangerActionStyle}
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
      )}

      {error && <p style={errorStyle}>{error}</p>}
    </div>
  );
}

const inlineStripStyle: React.CSSProperties = {
  padding: "6px 28px 8px",
  width: "100%",
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

const dangerActionStyle: React.CSSProperties = {
  ...actionStyle,
  color: "#E8807A",
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
  margin: "4px 0 0",
  color: "#E8807A",
  fontFamily: "Georgia, serif",
  fontSize: "10px",
  fontStyle: "italic",
};
