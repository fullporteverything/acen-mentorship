"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Site-wide AFK card.
 *
 * Mounted once in the dashboard layout so it covers every dashboard page.
 * After IDLE_MS with no activity, a blurred backdrop drops over the site and
 * a single playing card — the 7 of spades — slowly fades in, drifting gently,
 * with a dealer's aside along the bottom: "long night sir?".
 *
 * It stays until the member clicks (or presses a key). A stray mouse-move does
 * NOT dismiss it, so the pause holds until an intentional click/keypress.
 */

const IDLE_MS = 60_000;

export default function SiteMeditation({ idleMs = IDLE_MS }: { idleMs?: number } = {}) {
  const [afk, setAfk] = useState(false);
  const pathname = usePathname();

  // Watching a lesson video means long, legitimate stretches with no mouse or
  // keyboard input — the overlay would pop every idle period mid-video. So on
  // lesson-detail pages (where the video player lives) it never arms.
  const suppressed = /^\/dashboard\/lessons\/[^/]+/.test(pathname ?? "");

  // Ref mirror so the always-on listeners can read the latest state without
  // being torn down / re-added on every toggle.
  const afkRef = useRef(false);
  useEffect(() => {
    afkRef.current = afk;
  }, [afk]);

  useEffect(() => {
    if (suppressed) {
      setAfk(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setAfk(true), idleMs);
    };
    // Activity re-arms the idle timer — but only while awake. Once the card is
    // up, movement is ignored; it takes a click/keypress to return.
    const onActivity = () => {
      if (!afkRef.current) arm();
    };
    const dismiss = () => {
      if (afkRef.current) {
        setAfk(false);
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
      {afk && (
        <motion.div
          key="site-afk"
          aria-hidden
          onMouseDown={() => setAfk(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
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
          <AfkCard />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A 7 of spades that slowly fades in and drifts, "long night sir?" on the base. */
function AfkCard() {
  const corner = (pos: "tl" | "br"): CSSProperties => {
    const base: CSSProperties = {
      position: "absolute",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      lineHeight: 0.82,
      fontFamily: "Georgia, serif",
      fontWeight: 700,
      fontSize: 26,
      color: "#e3c071",
      userSelect: "none",
    };
    return pos === "tl"
      ? { ...base, top: 18, left: 20 }
      : { ...base, bottom: 18, right: 20, transform: "rotate(180deg)" };
  };

  return (
    <motion.div
      style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
      initial={{ opacity: 0, y: 22, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        // gentle perpetual drift once it has settled in
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: 2.2 }}
        style={{
          position: "relative",
          width: 220,
          height: 308,
          borderRadius: 20,
          background:
            "radial-gradient(130% 90% at 50% 0%, #171207 0%, #0a0805 55%, #000 100%)",
          border: "1px solid rgba(231,192,113,0.5)",
          boxShadow:
            "0 44px 100px -34px rgba(0,0,0,0.9), inset 0 1px 0 rgba(247,232,172,0.12), 0 0 46px rgba(231,192,113,0.12)",
          display: "grid",
          placeItems: "center",
        }}
      >
        {/* The two corner 7♠ are the focal point — they slowly glow in and out. */}
        <motion.span
          aria-hidden
          style={corner("tl")}
          animate={{
            opacity: [0.5, 1, 0.5],
            textShadow: [
              "0 0 0px rgba(231,192,113,0)",
              "0 0 20px rgba(231,192,113,0.95)",
              "0 0 0px rgba(231,192,113,0)",
            ],
          }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 2.2 }}
        >
          <span>7</span>
          <span style={{ fontSize: 20 }}>♠</span>
        </motion.span>
        <motion.span
          aria-hidden
          style={corner("br")}
          animate={{
            opacity: [0.5, 1, 0.5],
            textShadow: [
              "0 0 0px rgba(231,192,113,0)",
              "0 0 20px rgba(231,192,113,0.95)",
              "0 0 0px rgba(231,192,113,0)",
            ],
          }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 2.2 }}
        >
          <span>7</span>
          <span style={{ fontSize: 20 }}>♠</span>
        </motion.span>

        {/* center spade — calm backdrop now; the corner 7s carry the animation */}
        <span
          aria-hidden
          style={{
            fontSize: 104,
            lineHeight: 1,
            color: "rgba(231,192,113,0.3)",
            fontFamily: "Georgia, serif",
            transform: "translateY(-6px)",
          }}
        >
          ♠
        </span>

        {/* dealer's aside */}
        <p
          style={{
            position: "absolute",
            bottom: 22,
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 14,
            letterSpacing: 0.5,
            color: "rgba(247,232,172,0.8)",
          }}
        >
          long night sir?
        </p>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, delay: 2.4 }}
        style={{
          marginTop: 22,
          fontSize: 9,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "rgba(245,240,240,0.32)",
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
        }}
      >
        click to return
      </motion.p>
    </motion.div>
  );
}
