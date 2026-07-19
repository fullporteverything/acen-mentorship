"use client";

import { useState } from "react";

interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/**
 * Announcements feed on the Overview page. Unread items get a slow burgundy
 * pulse; hovering or clicking one fires POST /api/announcements/seen to mark
 * it read (fire-and-forget) and clears the pulse locally without waiting for
 * the round-trip.
 */
export default function AnnouncementsFeed({
  items,
  initialSeen,
}: {
  items: AnnouncementItem[];
  initialSeen: string[];
}) {
  const [seen, setSeen] = useState<Set<string>>(() => new Set(initialSeen));

  function markSeen(id: string) {
    if (seen.has(id)) return;
    setSeen((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    // Fire-and-forget: server write can lag, UI already updated.
    fetch("/api/announcements/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {
      /* silent — worst case: the pulse returns on next reload */
    });
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: "36px 32px",
          border: "1px solid rgba(232,160,160,0.10)",
          background: "rgba(232,160,160,0.02)",
          maxWidth: 640,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Kanji accent — same 気 the placeholder had */}
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 20,
            fontSize: 48,
            color: "rgba(232,160,160,0.06)",
            fontFamily: "serif",
            userSelect: "none",
            lineHeight: 1,
          }}
        >
          気
        </span>
        <p
          style={{
            fontSize: 9,
            letterSpacing: 4,
            color: "rgba(232,160,160,0.6)",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            marginBottom: 16,
          }}
        >
          Announcements
        </p>
        <p
          style={{
            fontSize: 15,
            color: "rgba(245,240,240,0.5)",
            fontFamily: "Georgia, serif",
            lineHeight: 1.9,
            fontStyle: "italic",
          }}
        >
          Nothing new right now. Announcements will appear here.
        </p>
        <div
          style={{
            width: 32,
            height: 1,
            background: "linear-gradient(90deg, #E8A0A0, transparent)",
            marginTop: 24,
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 16 }}>
      <p
        style={{
          fontSize: 9,
          letterSpacing: 4,
          color: "rgba(232,160,160,0.6)",
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
        }}
      >
        Announcements
      </p>

      {items.map((a) => {
        const isUnread = !seen.has(a.id);
        return (
          <article
            key={a.id}
            className={
              "announcement-card" + (isUnread ? " announcement-unread" : "")
            }
            onMouseEnter={() => markSeen(a.id)}
            onClick={() => markSeen(a.id)}
            style={{
              position: "relative",
              padding: "22px 24px",
              border: "1px solid rgba(232,160,160,0.15)",
              background: "rgba(232,160,160,0.03)",
              cursor: isUnread ? "pointer" : "default",
              overflow: "hidden",
            }}
          >
            {/* Small "NEW" tag for unread — reinforces the pulse */}
            {isUnread && (
              <span
                aria-label="Unread announcement"
                style={{
                  position: "absolute",
                  top: 12,
                  right: 14,
                  fontSize: 8,
                  letterSpacing: 3,
                  color: "#F0B0B0",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                  border: "1px solid rgba(232,160,160,0.55)",
                  padding: "2px 7px",
                }}
              >
                New
              </span>
            )}

            <p
              style={{
                fontSize: 15,
                color: "#E8A0A0",
                fontFamily: "Georgia, serif",
                letterSpacing: 1,
                marginBottom: 8,
                paddingRight: isUnread ? 48 : 0,
              }}
            >
              {a.title}
            </p>
            <p
              style={{
                fontSize: 14,
                color: "rgba(245,240,240,0.8)",
                fontFamily: "Georgia, serif",
                lineHeight: 1.85,
                whiteSpace: "pre-wrap",
              }}
            >
              {a.body}
            </p>
            <p
              style={{
                fontSize: 10,
                color: "rgba(245,240,240,0.4)",
                fontFamily: "Georgia, serif",
                marginTop: 12,
                letterSpacing: 1,
              }}
            >
              {new Date(a.createdAt).toLocaleDateString()}
            </p>
          </article>
        );
      })}
    </div>
  );
}
