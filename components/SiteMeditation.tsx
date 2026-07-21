"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Site-wide meditation mode.
 *
 * Mounted once in the dashboard layout so it covers every dashboard page.
 * After IDLE_MS with no activity, a blurred backdrop drops over the whole
 * site and a large glowing Φ *assembles itself in 3D* — rings draw on, the
 * glyph sketches (construction ellipse + bar) then solidifies into the serif
 * Φ — and finally settles into a perpetual pulse.
 *
 * It stays until the member clicks (or presses a key). A stray mouse-move
 * does NOT dismiss it, so the stillness holds "until mouse click".
 */

const IDLE_MS = 60_000;
const SIZE = 240;

export default function SiteMeditation({ idleMs = IDLE_MS }: { idleMs?: number } = {}) {
  const [meditating, setMeditating] = useState(false);
  const pathname = usePathname();

  // Watching a lesson video means long, legitimate stretches with no mouse or
  // keyboard input — the overlay would pop every idle period mid-video. So on
  // lesson-detail pages (where the video player lives) meditation never arms.
  const suppressed = /^\/dashboard\/lessons\/[^/]+/.test(pathname ?? "");

  // Ref mirror so the always-on listeners can read the latest state without
  // being torn down / re-added on every toggle.
  const meditatingRef = useRef(false);
  useEffect(() => {
    meditatingRef.current = meditating;
  }, [meditating]);

  useEffect(() => {
    if (suppressed) {
      // Entering a video page while meditating also clears the overlay.
      setMeditating(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setMeditating(true), idleMs);
    };

    // Activity re-arms the idle timer — but only while awake. Once we're
    // meditating, movement is ignored; it takes a click/keypress to return.
    const onActivity = () => {
      if (!meditatingRef.current) arm();
    };
    const dismiss = () => {
      if (meditatingRef.current) {
        setMeditating(false);
        arm();
      }
    };

    arm();

    const activity: (keyof WindowEventMap)[] = [
      "mousemove",
      "pointerdown",
      "keydown",
      "wheel",
      "scroll",
      "touchstart",
    ];
    for (const ev of activity) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    // Capture-phase so the dismissing click doesn't also trigger UI beneath.
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);

    return () => {
      clearTimeout(timer);
      for (const ev of activity) window.removeEventListener(ev, onActivity);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
    };
  }, [idleMs, suppressed]);

  return (
    <AnimatePresence>
      {meditating && (
        <motion.div
          key="site-meditation"
          aria-hidden
          onMouseDown={() => setMeditating(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 500,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(11px)",
            WebkitBackdropFilter: "blur(11px)",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              perspective: 1000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <MeditationPhi />
            <MeditationCaption />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The self-assembling Φ. Layer 1 does the one-shot 3D "build" (rotate into
 * frame + staged part draws); layer 2 carries the perpetual life (breathing
 * scale + slow 3D wobble) once the build is done.
 */
function MeditationPhi() {
  const s = SIZE;

  return (
    <motion.div
      style={{ width: s, height: s, transformStyle: "preserve-3d" }}
      initial={{ opacity: 0, rotateX: -42, rotateY: 20, scale: 0.82 }}
      animate={{ opacity: 1, rotateX: 0, rotateY: 0, scale: 1 }}
      transition={{ duration: 1.9, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        style={{ width: s, height: s, position: "relative", transformStyle: "preserve-3d" }}
        animate={{ scale: [1, 1.035, 1], rotateY: [0, 6, 0, -6, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      >
        <svg
          width={s}
          height={s}
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            <radialGradient id="med-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFD8D8" stopOpacity={0.4} />
              <stop offset="50%" stopColor="#E8A0A0" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#E8A0A0" stopOpacity={0} />
            </radialGradient>

            <linearGradient id="med-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#F0B0B0" />
              <stop offset="55%" stopColor="#E8A0A0" />
              <stop offset="100%" stopColor="#B26060" />
            </linearGradient>

            <filter id="med-glow" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="1.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Inner halo — fades in with the build, then pulses forever. */}
          <motion.circle
            cx={50}
            cy={50}
            r={30}
            fill="url(#med-halo)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.5, 1, 0.5], r: [26, 34, 26] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
          />

          {/* Outer ring — draws itself on. */}
          <motion.circle
            cx={50}
            cy={50}
            r={44}
            fill="none"
            stroke="rgba(232,160,160,0.5)"
            strokeWidth={0.6}
            strokeDasharray={300}
            initial={{ strokeDashoffset: 300 }}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: 1.3, ease: "easeInOut", delay: 0.15 }}
          />

          {/* Rotating outer tick ring — fades in, then spins forever. */}
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: -360 }}
            transition={{
              opacity: { duration: 0.9, delay: 0.6 },
              rotate: { duration: 16, repeat: Infinity, ease: "linear", delay: 0.6 },
            }}
          >
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 360) / 12;
              const major = i % 3 === 0;
              return (
                <line
                  key={i}
                  x1={50}
                  y1={4}
                  x2={50}
                  y2={major ? 10 : 7}
                  stroke="#E8A0A0"
                  strokeOpacity={major ? 0.85 : 0.4}
                  strokeWidth={major ? 1.2 : 0.7}
                  strokeLinecap="round"
                  transform={`rotate(${angle} 50 50)`}
                />
              );
            })}
          </motion.g>

          {/* Counter-rotating dashed inner ring — fades in. */}
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            animate={{ rotate: -360 }}
            transition={{ duration: 42, repeat: Infinity, ease: "linear" }}
          >
            <motion.circle
              cx={50}
              cy={50}
              r={36}
              fill="none"
              stroke="rgba(232,160,160,0.28)"
              strokeWidth={0.4}
              strokeDasharray="3 4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.9 }}
            />
          </motion.g>

          {/* Orbiting dots — appear, then orbit forever. */}
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: 360 }}
            transition={{
              opacity: { duration: 0.8, delay: 1.1 },
              rotate: { duration: 10, repeat: Infinity, ease: "linear", delay: 1.1 },
            }}
          >
            <circle cx={50} cy={12} r={1.6} fill="#F0B0B0" filter="url(#med-glow)" />
          </motion.g>
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.75, rotate: -360 }}
            transition={{
              opacity: { duration: 0.8, delay: 1.3 },
              rotate: { duration: 15, repeat: Infinity, ease: "linear", delay: 1.3 },
            }}
          >
            <circle cx={50} cy={88} r={1.2} fill="#F0B0B0" filter="url(#med-glow)" />
          </motion.g>

          {/* Solid serif Φ — fades in amid the ring build, then shimmers forever. */}
          <motion.g
            filter="url(#med-glow)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.1 }}
          >
            <motion.text
              x={50}
              y={70}
              textAnchor="middle"
              fontFamily="'Cormorant Garamond', Georgia, 'Times New Roman', serif"
              fontSize={58}
              fontWeight={500}
              fill="url(#med-fill)"
              animate={{ opacity: [0.9, 1, 0.9] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 1.9 }}
            >
              Φ
            </motion.text>
          </motion.g>
        </svg>
      </motion.div>
    </motion.div>
  );
}

/** 静 (stillness) tag + a faint return hint, fading in after the build. */
function MeditationCaption() {
  return (
    <motion.div
      style={{ marginTop: 28, textAlign: "center" }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, delay: 2.0 }}
    >
      <p
        style={{
          fontSize: 11,
          letterSpacing: 6,
          color: "rgba(232,160,160,0.75)",
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
        }}
      >
        静&nbsp;&nbsp;stillness
      </p>
      <p
        style={{
          marginTop: 10,
          fontSize: 9,
          letterSpacing: 3,
          color: "rgba(245,240,240,0.35)",
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
        }}
      >
        click to return
      </p>
    </motion.div>
  );
}
