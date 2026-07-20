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
    let active = true;
    fetch("/api/journal/feedback-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d?.latestFeedbackAt) return;
        const seen = localStorage.getItem(SEEN_KEY);
        if (!seen || new Date(d.latestFeedbackAt) > new Date(seen)) setShow(true);
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
