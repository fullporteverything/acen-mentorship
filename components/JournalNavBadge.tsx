"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "dojo:journalFeedbackSeen";

/**
 * Small dot on the Journal nav link when the mentor has left feedback the
 * member hasn't seen yet. "Seen" is stamped in localStorage whenever they open
 * the journal (see MarkFeedbackSeen). Renders inside the relatively-positioned
 * `.topnav-link`.
 */
export default function JournalNavBadge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const CACHE = "dojo:fbStatus";
    const TTL = 120000; // don't re-poll more than once every 2 min

    const evaluate = (latest: string | null) => {
      if (!latest) return;
      const seen = localStorage.getItem(SEEN_KEY);
      if (!seen || new Date(latest) > new Date(seen)) setShow(true);
    };

    // Reuse a recent poll so TopNav doesn't read the journal blob on every page.
    try {
      const raw = sessionStorage.getItem(CACHE);
      if (raw) {
        const c = JSON.parse(raw) as { latest: string | null; at: number };
        if (c && typeof c.at === "number" && Date.now() - c.at < TTL) {
          evaluate(c.latest);
          return;
        }
      }
    } catch {
      // ignore malformed cache
    }

    let active = true;
    fetch("/api/journal/feedback-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        const latest: string | null = d?.latestFeedbackAt ?? null;
        try {
          sessionStorage.setItem(CACHE, JSON.stringify({ latest, at: Date.now() }));
        } catch {
          // ignore
        }
        evaluate(latest);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!show) return null;
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: 4,
        right: 6,
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#E8A0A0",
        boxShadow: "0 0 6px rgba(232,160,160,0.9)",
      }}
    />
  );
}
