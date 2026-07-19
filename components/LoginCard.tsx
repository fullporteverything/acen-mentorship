"use client";

import { AnimatePresence, motion } from "framer-motion";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import PhiLogo from "@/components/PhiLogo";
import ThresholdOverlay from "@/components/ThresholdOverlay";
import CrackedGate from "@/components/CrackedGate";

// Idle time before the login card slips into meditation mode.
const MEDITATION_IDLE_MS = 30_000;

export default function LoginCard({ errorCode }: { errorCode?: string } = {}) {
  const [loading, setLoading] = useState(false);
  const [entering, setEntering] = useState(false);
  const [meditating, setMeditating] = useState(false);
  const errored = !!errorCode;

  // Safety fallback — if OAuth handoff hasn't navigated us away after 6s,
  // release the overlay so the user can retry instead of staring at black.
  useEffect(() => {
    if (!entering) return;
    const t = setTimeout(() => {
      setEntering(false);
      setLoading(false);
    }, 6000);
    return () => clearTimeout(t);
  }, [entering]);

  // Meditation mode — 30s of no interaction dims the card and enlarges the
  // Phi. Any pointer/key activity wakes it. Paused while the cracked-gate
  // overlay is showing or an OAuth cross is in flight.
  useEffect(() => {
    if (errored || entering) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setMeditating(true), MEDITATION_IDLE_MS);
    };
    const wake = () => {
      setMeditating(false);
      arm();
    };
    arm();
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
    ];
    for (const ev of events) window.addEventListener(ev, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, wake);
    };
  }, [errored, entering]);

  const handleDiscordLogin = async () => {
    setLoading(true);
    setEntering(true);
    setMeditating(false);
    // Fire the redirect in parallel with the overlay animation. The browser
    // typically navigates before the wipe finishes, so the transition covers
    // the whole handoff instead of tacking on extra wait time.
    signIn("discord", { callbackUrl: "/dashboard" }).catch(() => {
      setEntering(false);
      setLoading(false);
    });
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15, delayChildren: 0.3 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] },
    },
  };

  const lineVariants = {
    hidden: { scaleX: 0 },
    visible: {
      scaleX: 1,
      transition: { duration: 1.0, ease: "easeInOut" },
    },
  };

  return (
    <>
      <AnimatePresence>{entering && <ThresholdOverlay />}</AnimatePresence>
      <AnimatePresence>{errored && <CrackedGate code={errorCode} />}</AnimatePresence>

      {/* Meditation dimmer — fades in over the sakura when the user goes idle. */}
      <AnimatePresence>
        {meditating && (
          <motion.div
            aria-hidden
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 5,
              background: "rgba(0,0,0,0.55)",
              pointerEvents: "none",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

    <motion.div
      className="login-card"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col items-center gap-0"
      >
        {/* Phi mark — identity anchor. Scales up + rises in meditation mode.
           Reversible: remove this <motion.div>. */}
        <motion.div
          variants={itemVariants}
          style={{ marginBottom: 18, transformOrigin: "center" }}
          animate={{ scale: meditating ? 1.55 : 1, y: meditating ? -14 : 0 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <PhiLogo size={124} />
        </motion.div>

        {/* Wraps everything below the Phi so meditation can dim it in one motion. */}
        <motion.div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
          }}
          animate={{ opacity: meditating ? 0.18 : 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        >

        {/* Welcome */}
        <motion.p
          variants={itemVariants}
          style={{
            fontSize: "10px",
            letterSpacing: "5px",
            color: "#E8A0A0",
            textTransform: "uppercase",
            marginBottom: "16px",
            fontFamily: "Georgia, serif",
          }}
        >
          Welcome To
        </motion.p>

        {/* Main title */}
        <motion.h1
          variants={itemVariants}
          style={{
            fontSize: "36px",
            letterSpacing: "12px",
            color: "#F5F0F0",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            fontWeight: 400,
            marginBottom: "20px",
          }}
        >
          Dojo
        </motion.h1>

        {/* Top rule */}
        <motion.div
          variants={lineVariants}
          style={{
            width: "48px",
            height: "1px",
            background: "linear-gradient(90deg, transparent, #E8A0A0, transparent)",
            marginBottom: "24px",
            transformOrigin: "center",
          }}
        />

        {/* Subtitle */}
        <motion.p
          variants={itemVariants}
          style={{
            fontSize: "10px",
            letterSpacing: "4px",
            color: "#E8A0A0",
            textTransform: "uppercase",
            marginBottom: "16px",
            fontFamily: "Georgia, serif",
          }}
        >
          Private Mentorship
        </motion.p>

        {/* Tagline */}
        <motion.p
          variants={itemVariants}
          style={{
            fontSize: "13px",
            color: "rgba(245,240,240,0.6)",
            textAlign: "center",
            lineHeight: "1.8",
            marginBottom: "36px",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            maxWidth: "260px",
          }}
        >
          Discipline is forged in silence.
          <br />
          The way reveals itself to those who stay.
        </motion.p>

        {/* Discord button */}
        <motion.button
          variants={itemVariants}
          onClick={handleDiscordLogin}
          disabled={loading}
          className="btn-discord"
          style={{ marginBottom: "16px" }}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          {loading ? (
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ animation: "spin 1s linear infinite" }}
              >
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              Connecting...
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg width="14" height="11" viewBox="0 0 20 15" fill="currentColor">
                <path d="M16.93 1.33A16.47 16.47 0 0 0 12.87 0c-.18.33-.4.77-.54 1.12a15.26 15.26 0 0 0-4.66 0C7.53.77 7.3.33 7.12 0A16.45 16.45 0 0 0 3.06 1.34C.44 5.37-.27 9.3.08 13.17a16.6 16.6 0 0 0 5.07 2.59c.41-.56.77-1.16 1.09-1.8a10.77 10.77 0 0 1-1.71-.83l.41-.32a11.83 11.83 0 0 0 10.12 0l.42.32c-.54.33-1.11.6-1.72.83.32.64.68 1.24 1.09 1.8a16.55 16.55 0 0 0 5.08-2.6c.42-4.44-.72-8.3-3.02-11.86ZM6.68 10.8c-1 0-1.83-.93-1.83-2.08 0-1.15.81-2.09 1.83-2.09 1.02 0 1.85.94 1.83 2.09 0 1.15-.81 2.08-1.83 2.08Zm6.64 0c-1.01 0-1.84-.93-1.84-2.08 0-1.15.81-2.09 1.84-2.09 1.01 0 1.84.94 1.82 2.09 0 1.15-.8 2.08-1.82 2.08Z" />
              </svg>
              Enter With Discord
            </span>
          )}
        </motion.button>

        {/* Fine print */}
        <motion.p
          variants={itemVariants}
          style={{
            fontSize: "10px",
            color: "rgba(245,240,240,0.3)",
            letterSpacing: "1px",
            marginBottom: "24px",
            fontFamily: "Georgia, serif",
          }}
        >
          Members only — Authorized access required
        </motion.p>

        {/* Bottom rule */}
        <motion.div
          variants={lineVariants}
          style={{
            width: "48px",
            height: "1px",
            background: "linear-gradient(90deg, transparent, #E8A0A0, transparent)",
            transformOrigin: "center",
          }}
        />
        </motion.div>{/* end dim-on-meditation wrapper */}

        {/* Meditation tag — 静 (stillness), fades in only when idle. */}
        <AnimatePresence>
          {meditating && (
            <motion.p
              key="meditation-tag"
              style={{
                marginTop: 20,
                fontSize: 10,
                letterSpacing: 6,
                color: "rgba(232,160,160,0.7)",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
              }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
            >
              静&nbsp;&nbsp;stillness
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
    </>
  );
}
