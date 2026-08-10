"use client";

import { useCallback, useEffect, useState } from "react";
import RetryButton from "@/components/RetryButton";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
}

export default function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

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

  const unread = items.filter((item) => item.unread).length;

  async function toggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen) return;
    const unreadIds = items.filter((item) => item.unread).map((item) => item.id);
    if (unreadIds.length === 0) return;
    setItems((current) => current.map((item) => ({ ...item, unread: false })));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: unreadIds }),
    }).catch(() => {});
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={toggle}
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
              {items.map((item) => (
                <article key={item.id} style={itemStyle}>
                  <p style={{ color: "#E8A0A0", fontSize: 11, marginBottom: 4 }}>
                    {item.title}
                  </p>
                  <p style={{ ...mutedStyle, margin: 0 }}>{item.body}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  border: "1px solid rgba(232,160,160,0.28)",
  background: "rgba(0,0,0,0.65)",
  color: "#E8A0A0",
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
  width: 360,
  maxHeight: "70vh",
  overflowY: "auto",
  padding: 16,
  border: "1px solid rgba(232,160,160,0.24)",
  background: "rgba(5,3,3,0.98)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.6)",
  zIndex: 80,
};
const labelStyle: React.CSSProperties = { color: "#E8A0A0", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" };
const mutedStyle: React.CSSProperties = { color: "rgba(245,240,240,0.58)", fontFamily: "Georgia, serif", fontSize: 11, lineHeight: 1.55 };
const itemStyle: React.CSSProperties = { padding: 11, border: "1px solid rgba(232,160,160,0.1)", background: "rgba(232,160,160,0.035)" };
const retryStyle: React.CSSProperties = { border: 0, background: "transparent", color: "rgba(245,240,240,0.55)", fontSize: 10, cursor: "pointer" };
