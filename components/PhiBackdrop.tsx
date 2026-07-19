"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

/**
 * Drifting-Φ atmospheric layer for the Journal page — the dojo-flavored analog
 * of the "APOSTLES letters" scatter on the reference design. Positions and
 * per-letter phase are seeded by index (no Math.random) so server and client
 * render the same tree and hydration stays happy.
 */
export default function PhiBackdrop({ count = 34 }: { count?: number }) {
  const marks = useMemo(() => Array.from({ length: count }, (_, i) => makeMark(i)), [count]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      {marks.map((m, i) => (
        <motion.span
          key={i}
          style={{
            position: "absolute",
            left: `${m.x}%`,
            top: `${m.y}%`,
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: m.size,
            color: `rgba(232,160,160,${m.alpha})`,
            userSelect: "none",
            fontWeight: 500,
            filter: "blur(0.3px)",
          }}
          animate={{
            y: [0, m.drift, 0],
            x: [0, m.sway, 0],
            opacity: [m.alpha * 0.6, m.alpha, m.alpha * 0.6],
          }}
          transition={{
            duration: m.duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay: m.delay,
          }}
        >
          {m.char}
        </motion.span>
      ))}
    </div>
  );
}

const CHARS = ["Φ", "φ", "Φ", "φ", "Φ"];

function makeMark(i: number) {
  const r = seeded(i * 9301 + 49297);
  const r2 = seeded(i * 12421 + 91);
  const r3 = seeded(i * 63577 + 5);
  return {
    char: CHARS[i % CHARS.length],
    x: r * 100,
    y: r2 * 100,
    size: 14 + Math.floor(r3 * 46),
    alpha: 0.05 + r3 * 0.18,
    drift: -12 + r * 24,
    sway: -8 + r2 * 16,
    duration: 10 + r * 14,
    delay: r2 * 8,
  };
}

// Deterministic pseudorandom in [0, 1). Same input → same output.
function seeded(n: number): number {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}
