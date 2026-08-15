"use client";

import { useEffect, useRef, useState } from "react";

export interface KebabItem {
  /** Menu row label. */
  label: string;
  /** Called when the row is chosen; return a promise to signal busy state. */
  onSelect: () => void | Promise<void>;
  /** Renders in red — for destructive actions. */
  danger?: boolean;
  /** Disables the item without hiding it. */
  disabled?: boolean;
}

interface KebabProps {
  items: KebabItem[];
  /** Screen-reader label for the trigger button. */
  ariaLabel?: string;
  /** Small (14px) or default (16px) trigger. */
  size?: "sm" | "md";
  /** Attached to the .kebab wrapper — parent can hover-reveal it via CSS. */
  className?: string;
}

/**
 * Compact three-dot menu — used by the section header and per-lesson admin
 * controls in the lessons sidebar. The trigger is opacity-0 by default; the
 * parent row toggles `.kebab-visible` on hover (see globals.css) so admin
 * chrome stays out of the way. When the menu is open the button is force-shown
 * via `.is-open` so it doesn't disappear the moment the pointer moves inside
 * the popup.
 */
export default function Kebab({
  items,
  ariaLabel = "More options",
  size = "sm",
  className = "",
}: KebabProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dot = size === "sm" ? 3 : 4;

  return (
    <div
      ref={wrapRef}
      className={`kebab ${open ? "is-open" : ""} ${className}`.trim()}
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="kebab-trigger"
        style={{
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: 3,
          padding: size === "sm" ? "2px 6px" : "3px 7px",
          cursor: "pointer",
          color: "rgba(232,160,160,0.75)",
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          lineHeight: 1,
        }}
      >
        <span style={dotStyle(dot)} />
        <span style={dotStyle(dot)} />
        <span style={dotStyle(dot)} />
      </button>

      {open && (
        <div
          role="menu"
          className="kebab-menu"
          style={{
            // Flyout RIGHT of the trigger, vertically centered. Left covered
            // the row's own title; below covered the rows underneath. To the
            // right it floats over the content column's gutter, which is
            // empty next to the sidebar, so nothing legible sits beneath it.
            position: "absolute",
            top: "50%",
            left: "calc(100% + 6px)",
            transform: "translateY(-50%)",
            background: "#0a0000",
            border: "1px solid rgba(232,160,160,0.35)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.8)",
            padding: 4,
            zIndex: 60,
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (it.disabled) return;
                setOpen(false);
                await it.onSelect();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "8px 12px",
                fontFamily: "Georgia, serif",
                fontSize: 11,
                letterSpacing: 2,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                color: it.disabled
                  ? "rgba(245,240,240,0.3)"
                  : it.danger
                    ? "#E8807A"
                    : "rgba(245,240,240,0.75)",
                cursor: it.disabled ? "not-allowed" : "pointer",
                opacity: it.disabled ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (it.disabled) return;
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(232,160,160,0.08)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "transparent";
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function dotStyle(d: number): React.CSSProperties {
  return {
    width: d,
    height: d,
    borderRadius: "50%",
    background: "currentColor",
    display: "inline-block",
  };
}
