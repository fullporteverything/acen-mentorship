"use client";

import { useEffect } from "react";

/**
 * Stamps "feedback seen = now" in localStorage when the member opens their
 * journal, so the nav dot (JournalNavBadge) clears until newer feedback lands.
 */
export default function MarkFeedbackSeen() {
  useEffect(() => {
    try {
      localStorage.setItem("dojo:journalFeedbackSeen", new Date().toISOString());
    } catch {
      // ignore
    }
  }, []);
  return null;
}
