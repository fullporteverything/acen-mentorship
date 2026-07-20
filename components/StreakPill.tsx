"use client";

import { useEffect, useState } from "react";

/**
 * Streak pill — consecutive-day journaling streak, computed in the BROWSER's
 * local timezone so late-night posts count against the user's own calendar day
 * rather than the server's. Computation is deferred to after mount (never
 * inline in render): SSR would otherwise bake in a server-timezone count and
 * hydration would keep it, silently defeating the local-timezone intent.
 */
export default function StreakPill({ dates }: { dates: string[] }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(computeStreak(dates));
  }, [dates]);

  return (
    <div
      style={{
        border: "1px solid rgba(232,160,160,0.25)",
        background: "rgba(232,160,160,0.04)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 118,
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
        🔥
      </span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 19,
            fontWeight: 500,
            color: "#F5F0F0",
          }}
        >
          {count ?? "—"}
        </span>
        <span
          style={{
            fontSize: 8,
            letterSpacing: 2,
            color: "rgba(245,240,240,0.55)",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            marginTop: 2,
          }}
        >
          day streak
        </span>
      </div>
    </div>
  );
}

/**
 * Consecutive-day streak ending at the most recent entry.
 * Uses local calendar days.
 */
function computeStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const days = new Set<string>();
  for (const iso of dates) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) continue;
    days.add(dayKey(d));
  }
  if (days.size === 0) return 0;

  // Start from today if there's an entry today, otherwise start from the most
  // recent entry's day (so a streak is still visible if you haven't posted yet
  // today but had one yesterday).
  const today = dayKey(new Date());
  let cursor = new Date();
  if (!days.has(today)) {
    const latest = dates
      .map((iso) => new Date(iso))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latest) return 0;
    cursor = latest;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
