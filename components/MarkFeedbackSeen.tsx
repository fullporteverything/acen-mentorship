"use client";

import { useEffect, useRef, useState } from "react";

const SEEN_KEY = "dojo:journalFeedbackSeen";

/**
 * Snapshot of the stamp as it stood *before* this visit overwrote it. Module
 * scope so every chip on the page reads the same pre-visit value regardless of
 * how the effects interleave.
 */
let preVisitStamp: string | null = null;
let captured = false;

function capturePreVisitStamp(): void {
  try {
    preVisitStamp = localStorage.getItem(SEEN_KEY);
  } catch {
    preVisitStamp = null;
  }
  captured = true;
}

/** Pre-visit stamp, falling back to a read if the marker never mounted. */
function readPreVisitStamp(): string | null {
  if (!captured) capturePreVisitStamp();
  return preVisitStamp;
}

/**
 * Stamps "feedback seen = now" in localStorage when the member opens their
 * journal, so the nav dot (JournalNavBadge) clears until newer feedback lands.
 * The previous stamp is snapshotted first, so NewFeedbackChip can still tell
 * which feedback arrived since the member last looked.
 */
export default function MarkFeedbackSeen() {
  const stamped = useRef(false);

  useEffect(() => {
    // Guarded by a ref rather than the module flag: a re-run within the same
    // mount (StrictMode) must not re-snapshot our own fresh stamp, but a real
    // remount on the next visit must.
    if (stamped.current) return;
    stamped.current = true;
    capturePreVisitStamp();
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      // ignore
    }
  }, []);

  return null;
}

/**
 * Small burgundy chip beside an entry's timestamp when its mentor feedback is
 * newer than the stamp from the member's previous visit. Client-side because
 * the stamp lives in localStorage; renders nothing on the server so hydration
 * stays clean. MarkFeedbackSeen sits above the entries in the tree, so its
 * effect has already snapshotted the pre-visit value by the time this runs.
 */
export function NewFeedbackChip({ feedbackAt }: { feedbackAt?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!feedbackAt) return;
    const feedbackTime = new Date(feedbackAt).getTime();
    if (Number.isNaN(feedbackTime)) return;
    const stamp = readPreVisitStamp();
    const seenTime = stamp ? new Date(stamp).getTime() : NaN;
    setShow(Number.isNaN(seenTime) || feedbackTime > seenTime);
  }, [feedbackAt]);

  if (!show) return null;
  return (
    <span
      style={{
        fontSize: 8,
        letterSpacing: 2,
        textTransform: "uppercase",
        fontFamily: "Georgia, serif",
        color: "#E8A0A0",
        border: "1px solid rgba(232,160,160,0.35)",
        padding: "1px 7px",
        lineHeight: 1.6,
      }}
    >
      New feedback
    </span>
  );
}
