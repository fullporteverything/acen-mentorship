"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";

/**
 * Animated oni (鬼) mask rendered as inline SVG.
 *
 * Sits in the top-left of the sidebar in place of the previous "DOJO /
 * MENTORSHIP" text lockup. All animation is framer-motion + SVG — no external
 * assets, no runtime dependency beyond what the site already ships.
 *
 * Behaviours (layered on top of each other):
 *   1. slow breathing scale                                 (always on)
 *   2. crimson eye pulse                                    (always on)
 *   3. occasional "rage" flash — halo blooms + mask jolts   (every ~6s)
 *   4. mouse-parallax tilt when the pointer is nearby       (pointer over sidebar)
 *   5. on-mount reveal (fade + soften from a hard flash)    (once)
 */
export default function OniMask({ size = 132 }: { size?: number }) {
  // Pointer parallax — a small tilt that tracks the cursor while it's over
  // the sidebar. Spring-smoothed so it never feels twitchy.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotY = useSpring(useTransform(px, [-1, 1], [-14, 14]), {
    stiffness: 90,
    damping: 14,
  });
  const rotX = useSpring(useTransform(py, [-1, 1], [10, -10]), {
    stiffness: 90,
    damping: 14,
  });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const sidebar = el.closest("aside") ?? el;

    function onMove(e: MouseEvent) {
      const r = (sidebar as HTMLElement).getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + Math.min(r.height / 2, 160);
      const dx = (e.clientX - cx) / (r.width / 2);
      const dy = (e.clientY - cy) / 200;
      px.set(Math.max(-1, Math.min(1, dx)));
      py.set(Math.max(-1, Math.min(1, dy)));
    }
    function onLeave() {
      px.set(0);
      py.set(0);
    }
    sidebar.addEventListener("mousemove", onMove as EventListener);
    sidebar.addEventListener("mouseleave", onLeave);
    return () => {
      sidebar.removeEventListener("mousemove", onMove as EventListener);
      sidebar.removeEventListener("mouseleave", onLeave);
    };
  }, [px, py]);

  return (
    <div
      ref={wrapperRef}
      style={{
        padding: "18px 28px 22px",
        borderBottom: "1px solid rgba(232,160,160,0.12)",
        marginBottom: "22px",
        perspective: 800,
      }}
    >
      <motion.div
        style={{
          width: size,
          height: size,
          margin: "0 auto",
          rotateX: rotX,
          rotateY: rotY,
          transformStyle: "preserve-3d",
          position: "relative",
        }}
        // On-mount: hard bloom that softens into place.
        initial={{ opacity: 0, scale: 1.25, filter: "brightness(2.4)" }}
        animate={{ opacity: 1, scale: 1, filter: "brightness(1)" }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Halo — the "rage flash". Behind the mask so it blooms around the silhouette. */}
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            inset: -18,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(232,80,80,0.55) 0%, rgba(232,80,80,0) 65%)",
            filter: "blur(6px)",
            pointerEvents: "none",
          }}
          animate={{ opacity: [0, 0, 0.9, 0], scale: [0.85, 0.85, 1.15, 1.35] }}
          transition={{
            duration: 6,
            times: [0, 0.75, 0.82, 1],
            repeat: Infinity,
            ease: "easeOut",
          }}
        />

        {/* Breathing wrapper — scales the whole mask ~2%. */}
        <motion.div
          style={{ width: "100%", height: "100%", position: "relative" }}
          animate={{ scale: [1, 1.025, 1], y: [0, -1, 0] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Rage jolt — a tiny yank forward, timed to line up with the flash. */}
          <motion.div
            style={{ width: "100%", height: "100%" }}
            animate={{ scale: [1, 1, 1.06, 1], rotate: [0, 0, -1.5, 0] }}
            transition={{
              duration: 6,
              times: [0, 0.78, 0.83, 0.92],
              repeat: Infinity,
              ease: "easeOut",
            }}
          >
            <OniSvg size={size} />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Small caption so the nav still reads. */}
      <p
        style={{
          marginTop: 14,
          textAlign: "center",
          fontSize: 9,
          letterSpacing: 5,
          color: "rgba(232,160,160,0.55)",
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
        }}
      >
        Dojo
      </p>
    </div>
  );
}

function OniSvg({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        {/* Face gradient — deep crimson with a lit forehead. */}
        <radialGradient id="oni-face" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#C24040" />
          <stop offset="55%" stopColor="#7A1414" />
          <stop offset="100%" stopColor="#2E0606" />
        </radialGradient>

        {/* Horn gradient — bone → ember. */}
        <linearGradient id="oni-horn" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F5E9C8" />
          <stop offset="60%" stopColor="#C89860" />
          <stop offset="100%" stopColor="#5A2A10" />
        </linearGradient>

        {/* Eye glow — the pulsing pupil. */}
        <radialGradient id="oni-eye" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF3D0" />
          <stop offset="35%" stopColor="#FFC060" />
          <stop offset="75%" stopColor="#E24810" />
          <stop offset="100%" stopColor="#3A0800" />
        </radialGradient>

        <filter id="oni-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="oni-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Horns — drawn first so the face silhouette overlaps their base. */}
      <path
        d="M 42 58 C 26 34, 22 18, 34 8 C 40 22, 50 38, 62 52 Z"
        fill="url(#oni-horn)"
        stroke="#1a0000"
        strokeWidth={1.2}
      />
      <path
        d="M 158 58 C 174 34, 178 18, 166 8 C 160 22, 150 38, 138 52 Z"
        fill="url(#oni-horn)"
        stroke="#1a0000"
        strokeWidth={1.2}
      />

      {/* Face silhouette — a broad jaw with a pointed chin. */}
      <path
        d="M 100 22
           C 60 22, 40 44, 40 78
           C 40 108, 52 138, 78 162
           C 88 172, 96 182, 100 190
           C 104 182, 112 172, 122 162
           C 148 138, 160 108, 160 78
           C 160 44, 140 22, 100 22 Z"
        fill="url(#oni-face)"
        stroke="#1a0000"
        strokeWidth={1.5}
      />

      {/* Cheek warpaint — thin black claw-strokes. */}
      <g stroke="#0a0000" strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.85}>
        <path d="M 52 118 Q 62 122, 72 116" />
        <path d="M 50 128 Q 62 134, 74 128" />
        <path d="M 148 118 Q 138 122, 128 116" />
        <path d="M 150 128 Q 138 134, 126 128" />
      </g>

      {/* Forehead brand (kanji 鬼 = oni). */}
      <text
        x={100}
        y={62}
        textAnchor="middle"
        fontSize={22}
        fontFamily="serif"
        fill="#1a0000"
        opacity={0.55}
      >
        鬼
      </text>

      {/* Brow ridges — angry, sloped inward. */}
      <path
        d="M 54 82 L 90 74 L 88 86 L 58 92 Z"
        fill="#1a0000"
      />
      <path
        d="M 146 82 L 110 74 L 112 86 L 142 92 Z"
        fill="#1a0000"
      />

      {/* Eye sockets — dark voids the pulse punches through. */}
      <ellipse cx={72} cy={102} rx={14} ry={9} fill="#0a0000" />
      <ellipse cx={128} cy={102} rx={14} ry={9} fill="#0a0000" />

      {/* Animated pupil glow — outer bloom (opacity pulses). */}
      <motion.g filter="url(#oni-glow)">
        <motion.circle
          cx={72}
          cy={102}
          r={7}
          fill="url(#oni-eye)"
          animate={{ opacity: [0.55, 1, 0.55], r: [7, 8.5, 7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx={128}
          cy={102}
          r={7}
          fill="url(#oni-eye)"
          animate={{ opacity: [0.55, 1, 0.55], r: [7, 8.5, 7] }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 0.15,
          }}
        />
      </motion.g>

      {/* Sharp inner pupil dot — steady, gives the eyes focus. */}
      <circle cx={72} cy={102} r={1.6} fill="#0a0000" />
      <circle cx={128} cy={102} r={1.6} fill="#0a0000" />

      {/* Nose — a broken triangular ridge. */}
      <path
        d="M 100 100 L 92 128 L 100 132 L 108 128 Z"
        fill="#3A0808"
        stroke="#1a0000"
        strokeWidth={1}
      />

      {/* Mouth — snarling grin. */}
      <path
        d="M 74 148
           C 82 158, 118 158, 126 148
           L 122 152
           L 118 148 L 112 154 L 106 148 L 100 154 L 94 148 L 88 154 L 82 148 L 78 152 Z"
        fill="#0a0000"
      />

      {/* Tusks — jut down past the jawline. */}
      <path
        d="M 82 150 L 78 172 L 86 158 Z"
        fill="#F5E9C8"
        stroke="#1a0000"
        strokeWidth={1}
      />
      <path
        d="M 118 150 L 122 172 L 114 158 Z"
        fill="#F5E9C8"
        stroke="#1a0000"
        strokeWidth={1}
      />

      {/* Highlight glaze — a soft top-of-face sheen. */}
      <ellipse
        cx={100}
        cy={54}
        rx={44}
        ry={14}
        fill="#FFB0A0"
        opacity={0.10}
        filter="url(#oni-soft)"
      />
    </svg>
  );
}
