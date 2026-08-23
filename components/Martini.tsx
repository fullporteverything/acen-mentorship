"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The martini — a side flourish for The Table. SVG glass with a liquid whose
 * surface sloshes under damped spring physics (angle + angular velocity,
 * nudged by hover/click impulses plus a whisper of ambient sway), all drawn
 * inside a clip-path of the conical bowl.
 *
 * Engineering notes:
 *   - One rAF loop mutates the SVG nodes directly through refs (no React
 *     re-render per frame). It pauses while document.hidden and is fully
 *     torn down on unmount.
 *   - prefers-reduced-motion: no loop at all — a static, level surface that
 *     simply repaints when the level changes.
 *   - Level (0–5 sips) persists in localStorage `suite7:martini` (try/catch).
 */

const MARTINI_KEY = "suite7:martini";
const MAX_LEVEL = 5;

// Bowl geometry (viewBox 0 0 220 300): rim y=50, interior apex ≈ (110,148).
const APEX_Y = 146;
const FULL_Y = 62; // surface y when full
const BOTTOM_Y = 152; // liquid polygon under-run (clipped by the bowl)

function surfaceY(level01: number): number {
  return APEX_Y - (APEX_Y - FULL_Y) * level01;
}

/** Half-width of the bowl interior at a given y (edges taper to the apex). */
function halfWidthAt(y: number): number {
  return Math.max(0, 72 - 0.75 * (y - 52));
}

export default function Martini() {
  const [level, setLevel] = useState<number | null>(null); // sips left; null until loaded
  const [reduced, setReduced] = useState(false);

  // Physics + display state lives in refs — the rAF loop owns it.
  const angleRef = useRef(0); // surface tilt (px of rise/fall at bowl edge)
  const velRef = useRef(0);
  const shownLevelRef = useRef(1); // 0..1, eased toward the target
  const targetLevelRef = useRef(1); // 0..1
  const fillRateRef = useRef(3); // 1/s easing rate (slow for the pour)
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const reducedActual = useRef(false);

  const liquidRef = useRef<SVGPathElement | null>(null);
  const surfaceRef = useRef<SVGPathElement | null>(null);
  const oliveRef = useRef<SVGGElement | null>(null);
  const pickRef = useRef<SVGLineElement | null>(null);

  /** Draw the liquid, surface line, olive and pick from the physics refs. */
  const paint = useCallback((tMs: number) => {
    const lvl = shownLevelRef.current;
    const tilt = angleRef.current;
    const sy = surfaceY(lvl);

    if (liquidRef.current && surfaceRef.current) {
      if (lvl <= 0.005) {
        liquidRef.current.setAttribute("d", "M0,0Z");
        surfaceRef.current.setAttribute("d", "M0,0Z");
      } else {
        const yL = sy - tilt;
        const yR = sy + tilt;
        liquidRef.current.setAttribute(
          "d",
          `M28,${yL.toFixed(2)} L192,${yR.toFixed(2)} L192,${BOTTOM_Y} L28,${BOTTOM_Y} Z`
        );
        surfaceRef.current.setAttribute("d", `M28,${yL.toFixed(2)} L192,${yR.toFixed(2)}`);
      }
    }

    // Olive: bobs just under the surface while liquid remains; rests at the
    // bottom of the bowl once the glass is empty.
    if (oliveRef.current && pickRef.current) {
      let ox: number;
      let oy: number;
      if (lvl > 0.05) {
        const drift = Math.min(10, Math.max(0, halfWidthAt(sy) - 12));
        const bob = reducedActual.current ? 0 : Math.sin(tMs / 900) * 1.6;
        ox = 110 + (reducedActual.current ? 0 : Math.sin(tMs / 1400) * drift * 0.4);
        oy = Math.min(APEX_Y - 8, sy + 6) + bob;
      } else {
        ox = 110;
        oy = 137;
      }
      oliveRef.current.setAttribute("transform", `translate(${ox.toFixed(2)},${oy.toFixed(2)})`);
      pickRef.current.setAttribute("x2", ox.toFixed(2));
      pickRef.current.setAttribute("y2", (oy - 3).toFixed(2));
    }
  }, []);

  // Load the persisted level once, client-side only.
  useEffect(() => {
    let sips = MAX_LEVEL;
    try {
      const raw = window.localStorage.getItem(MARTINI_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_LEVEL) sips = parsed;
      }
    } catch {
      // Fine — pour a fresh one.
    }
    setLevel(sips);
    shownLevelRef.current = sips / MAX_LEVEL;
    targetLevelRef.current = sips / MAX_LEVEL;
    paint(0);
  }, [paint]);

  // Reduced-motion preference.
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedActual.current = mq.matches;
      setReduced(mq.matches);
      const onChange = () => {
        reducedActual.current = mq.matches;
        setReduced(mq.matches);
      };
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      return undefined;
    }
  }, []);

  // The slosh loop. Skipped entirely under reduced motion (static surface);
  // paused while the tab is hidden.
  useEffect(() => {
    if (level === null || reduced) return undefined;

    const step = (ts: number) => {
      const last = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = Math.min(0.05, last === null ? 0.016 : (ts - last) / 1000);

      // Damped spring toward level (0 tilt) + faint ambient sway forcing.
      const k = 24; // spring stiffness
      const c = 3.2; // damping
      const sway = Math.sin(ts / 1300) * 0.35;
      velRef.current += (-k * (angleRef.current - sway) - c * velRef.current) * dt;
      angleRef.current += velRef.current * dt;

      // Ease the displayed level toward the target (sip drop / refill pour).
      const target = targetLevelRef.current;
      const shown = shownLevelRef.current;
      if (Math.abs(target - shown) > 0.0005) {
        shownLevelRef.current = shown + (target - shown) * Math.min(1, fillRateRef.current * dt);
      } else {
        shownLevelRef.current = target;
      }

      paint(ts);
      rafRef.current = requestAnimationFrame(step);
    };

    const start = () => {
      if (rafRef.current === null) {
        lastTsRef.current = null;
        rafRef.current = requestAnimationFrame(step);
      }
    };
    const stop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [level, reduced, paint]);

  // Under reduced motion the surface is static: snap and repaint per change.
  useEffect(() => {
    if (level === null || !reduced) return;
    angleRef.current = 0;
    velRef.current = 0;
    shownLevelRef.current = level / MAX_LEVEL;
    targetLevelRef.current = level / MAX_LEVEL;
    paint(0);
  }, [level, reduced, paint]);

  const persist = useCallback((sips: number) => {
    try {
      window.localStorage.setItem(MARTINI_KEY, String(sips));
    } catch {
      // Non-fatal.
    }
  }, []);

  const nudge = useCallback((impulse: number) => {
    velRef.current += impulse;
  }, []);

  const sip = useCallback(() => {
    setLevel((prev) => {
      if (prev === null) return prev;
      if (prev <= 0) {
        // "another round?" — pour it back slowly.
        fillRateRef.current = 1.1;
        targetLevelRef.current = 1;
        nudge(-6);
        persist(MAX_LEVEL);
        return MAX_LEVEL;
      }
      const next = prev - 1;
      fillRateRef.current = 3.2;
      targetLevelRef.current = next / MAX_LEVEL;
      nudge(9); // a healthier slosh than a hover graze
      persist(next);
      return next;
    });
  }, [nudge, persist]);

  const empty = level !== null && level <= 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        paddingTop: 8,
        width: 180,
      }}
    >
      <svg
        viewBox="0 0 220 300"
        width={160}
        height={218}
        role="img"
        aria-label={empty ? "An empty martini glass" : "A martini, mostly untouched"}
        onMouseEnter={() => nudge(3.5)}
        onClick={() => nudge(6)}
        style={{ display: "block", cursor: "pointer", overflow: "visible" }}
      >
        <defs>
          <clipPath id="suite7-bowl-clip">
            <polygon points="38,52 182,52 110,148" />
          </clipPath>
          <linearGradient id="suite7-gin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="rgba(247,232,172,0.34)" />
            <stop offset="1" stopColor="rgba(184,147,74,0.16)" />
          </linearGradient>
        </defs>

        {/* Liquid + tilting surface line, clipped to the bowl interior */}
        <g clipPath="url(#suite7-bowl-clip)">
          <path ref={liquidRef} d="M0,0Z" fill="url(#suite7-gin)" />
          <path
            ref={surfaceRef}
            d="M0,0Z"
            fill="none"
            stroke="rgba(247,232,172,0.75)"
            strokeWidth="1.2"
          />
          {/* Faint glass reflections inside the bowl */}
          <line x1="58" y1="58" x2="96" y2="112" stroke="rgba(245,240,240,0.10)" strokeWidth="2" />
          <line x1="70" y1="56" x2="100" y2="100" stroke="rgba(245,240,240,0.05)" strokeWidth="4" />
        </g>

        {/* Cocktail pick + olive (above the liquid so the pick reads) */}
        <line
          ref={pickRef}
          x1="156"
          y1="30"
          x2="110"
          y2="96"
          stroke="rgba(231,192,113,0.75)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <g ref={oliveRef} transform="translate(110,96)">
          <circle r="7" fill="#66722f" stroke="rgba(0,0,0,0.45)" strokeWidth="1" />
          <circle r="2.4" cx="1.5" cy="-1" fill="#b21d3b" />
          <circle r="1.6" cx="-2.5" cy="2" fill="rgba(245,240,240,0.18)" />
        </g>

        {/* The glass itself, drawn last so its lines sit over the liquid */}
        <g fill="none" strokeLinecap="round">
          {/* Bowl */}
          <path d="M35,50 L110,150 L185,50" stroke="rgba(231,192,113,0.55)" strokeWidth="2" />
          {/* Rim + highlight */}
          <line x1="35" y1="50" x2="185" y2="50" stroke="rgba(231,192,113,0.55)" strokeWidth="2" />
          <line x1="52" y1="47.5" x2="126" y2="47.5" stroke="rgba(247,232,172,0.55)" strokeWidth="1" />
          {/* Stem */}
          <line x1="110" y1="150" x2="110" y2="245" stroke="rgba(231,192,113,0.55)" strokeWidth="2.4" />
          {/* Base */}
          <ellipse cx="110" cy="250" rx="42" ry="7" stroke="rgba(231,192,113,0.55)" strokeWidth="2" />
          <ellipse cx="110" cy="249" rx="26" ry="3.6" stroke="rgba(247,232,172,0.25)" strokeWidth="1" />
        </g>
      </svg>

      <button type="button" className="suite7-btn" onClick={sip} disabled={level === null}>
        {empty ? "another round?" : "take a sip"}
      </button>

      <span
        style={{
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontSize: 10,
          letterSpacing: 1.5,
          color: "rgba(245,240,240,0.4)",
        }}
      >
        on the house
      </span>
    </div>
  );
}
