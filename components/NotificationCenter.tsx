"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RetryButton from "@/components/RetryButton";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
}

/**
 * Where an item sends you, derived from the composite id the notifications
 * route mints (see app/api/notifications/route.ts):
 *
 *   homework:<lessonId>:<timestamp>:<status>  → that lesson
 *   journal:<entryId>:<feedbackAt>            → the journal
 *   announcement:… / security:…               → nowhere to go
 *
 * Lesson ids are colon-free slugs ("lesson-1"), so the second segment is safe
 * to read off a plain split even though the timestamp after it isn't.
 */
function targetFor(id: string): string | null {
  const [kind, first] = id.split(":");
  if (kind === "homework") {
    return first ? `/dashboard/lessons/${encodeURIComponent(first)}` : "/dashboard/homework";
  }
  if (kind === "journal") return "/dashboard/journal";
  return null;
}

/** "just now" / "4h ago" / "3d ago" — coarse on purpose, the panel is narrow. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export default function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setError(false);
    fetch("/api/notifications")
      .then((response) => {
        if (!response.ok) throw new Error("notification load failed");
        return response.json();
      })
      .then((data) => setItems(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setError(true));
  }, []);

  useEffect(() => load(), [load]);

  // Dismiss on Escape or a click outside the panel — same contract as Kebab.
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

  const unread = items.filter((item) => item.unread).length;

  /** Opening no longer clears the badge — reading an item does. */
  function markRead(item: NotificationItem) {
    if (!item.unread) return;
    setItems((current) =>
      current.map((n) => (n.id === item.id ? { ...n, unread: false } : n))
    );
    void fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [item.id] }),
    }).catch(() => {});
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="topnav-notice-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        style={triggerStyle}
      >
        Notice{unread > 0 ? ` · ${unread}` : ""}
      </button>
      {open && (
        <div style={panelStyle} role="region" aria-label="Notifications">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <p style={labelStyle}>Notifications</p>
            <button type="button" onClick={load} style={retryStyle}>Refresh</button>
          </div>
          {error ? (
            <div className="state-message state-message-error">
              <p>Couldn&apos;t load notifications.</p>
              <RetryButton onRetry={load} />
            </div>
          ) : items.length === 0 ? (
            <div className="state-message"><p>You&apos;re all caught up.</p></div>
          ) : (
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              {items.map((item) => {
                const href = targetFor(item.id);
                const style = item.unread
                  ? { ...itemStyle, ...unreadItemStyle }
                  : itemStyle;
                const inner = (
                  <>
                    <p style={{ color: "#e3c071", fontSize: 11, marginBottom: 4 }}>
                      {item.title}
                    </p>
                    <p style={{ ...mutedStyle, margin: 0, whiteSpace: "pre-wrap" }}>{item.body}</p>
                    <p style={stampStyle}>{relativeTime(item.createdAt)}</p>
                  </>
                );
                // Linkable items navigate; the rest are still clickable so a
                // member can knock them off the unread count.
                return href ? (
                  <a
                    key={item.id}
                    href={href}
                    onClick={() => markRead(item)}
                    style={{ ...style, display: "block", textDecoration: "none" }}
                  >
                    {inner}
                  </a>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => markRead(item)}
                    style={{
                      ...style,
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      font: "inherit",
                      cursor: item.unread ? "pointer" : "default",
                    }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  border: "1px solid rgba(231,192,113,0.28)",
  background: "rgba(0,0,0,0.65)",
  color: "#e3c071",
  padding: "8px 10px",
  fontFamily: "Georgia, serif",
  fontSize: 9,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  cursor: "pointer",
};
const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 12px)",
  right: 0,
  // Phones: never wider than the viewport minus the topnav's side gutters.
  width: "min(360px, calc(100vw - 28px))",
  maxHeight: "70vh",
  overflowY: "auto",
  padding: 16,
  border: "1px solid rgba(231,192,113,0.24)",
  background: "rgba(5,3,3,0.98)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
  zIndex: 80,
};
const labelStyle: React.CSSProperties = { color: "#e3c071", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" };
const mutedStyle: React.CSSProperties = { color: "rgba(245,240,240,0.58)", fontFamily: "Georgia, serif", fontSize: 11, lineHeight: 1.55 };
const itemStyle: React.CSSProperties = { padding: 11, border: "1px solid rgba(231,192,113,0.1)", background: "rgba(231,192,113,0.035)" };
/** Unread marker — a single burgundy rule down the left edge. */
const unreadItemStyle: React.CSSProperties = { borderLeft: "1px solid #e3c071" };
const stampStyle: React.CSSProperties = { marginTop: 7, color: "rgba(231,192,113,0.5)", fontFamily: "Georgia, serif", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase" };
const retryStyle: React.CSSProperties = { border: 0, background: "transparent", color: "rgba(245,240,240,0.55)", fontSize: 10, cursor: "pointer" };
