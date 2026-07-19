"use client";

import { motion } from "framer-motion";
import PhiLogo from "@/components/PhiLogo";

/**
 * Fullscreen "threshold cross" transition played while OAuth is redirecting.
 *
 * Renders as a fixed overlay above everything else. A circular clip-path grows
 * out from the center, washing the page in void black with a large pulsing
 * Phi at the middle — reads as "gate closing behind you". OAuth's browser
 * navigation almost always resolves before this animation would matter, so
 * the overlay's real job is to make the handoff feel intentional instead of
 * blank.
 *
 * Reversible: delete this file and its usage in LoginCard.tsx.
 */
export default function ThresholdOverlay() {
  return (
    <motion.div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background:
          "radial-gradient(circle at 50% 50%, #1a0000 0%, #000000 55%, #000000 100%)",
        display: "grid",
        placeItems: "center",
        pointerEvents: "auto",
      }}
      initial={{ clipPath: "circle(0% at 50% 50%)" }}
      animate={{ clipPath: "circle(150% at 50% 50%)" }}
      transition={{ duration: 0.85, ease: [0.65, 0, 0.35, 1] }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
      >
        <PhiLogo size={220} />
      </motion.div>

      <motion.p
        style={{
          position: "absolute",
          bottom: "18%",
          fontSize: 10,
          letterSpacing: 6,
          color: "rgba(232,160,160,0.7)",
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0.6, 1] }}
        transition={{
          duration: 2.2,
          delay: 0.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        Crossing the threshold
      </motion.p>
    </motion.div>
  );
}
