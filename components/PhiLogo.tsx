"use client";

import { motion } from "framer-motion";

/**
 * Animated Greek Φ (Phi) logo. Renders inline SVG — no external assets.
 *
 * Layered animations:
 *   1. slow rotating outer tick ring (12 marks)                (always on)
 *   2. counter-rotating inner ring                             (always on)
 *   3. two orbiting dots at opposing phases                    (always on)
 *   4. inner halo glow pulse                                   (always on)
 *   5. breathing scale on the whole mark                       (always on)
 *   6. periodic bright flash — halo blooms every ~7s           (always on)
 *   7. on-mount reveal — draw-in of the rings + Phi fade-up    (once)
 */
export default function PhiLogo({ size = 56 }: { size?: number }) {
  return (
    <motion.div
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "grid",
        placeItems: "center",
      }}
      initial={{ opacity: 0, scale: 0.6, filter: "brightness(2.2)" }}
      animate={{ opacity: 1, scale: 1, filter: "brightness(1)" }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Rage flash — periodic halo bloom behind the mark. */}
      <motion.div
        aria-hidden
        style={{
          position: "absolute",
          inset: -14,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(232,160,160,0.55) 0%, rgba(232,160,160,0) 65%)",
          filter: "blur(6px)",
          pointerEvents: "none",
        }}
        animate={{ opacity: [0, 0, 0.9, 0], scale: [0.8, 0.8, 1.2, 1.5] }}
        transition={{
          duration: 7,
          times: [0, 0.78, 0.86, 1],
          repeat: Infinity,
          ease: "easeOut",
        }}
      />

      <motion.div
        style={{ width: size, height: size, position: "relative" }}
        animate={{ scale: [1, 1.035, 1] }}
        transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            <radialGradient id="phi-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFD8D8" stopOpacity={0.35} />
              <stop offset="50%" stopColor="#E8A0A0" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#E8A0A0" stopOpacity={0} />
            </radialGradient>

            <linearGradient id="phi-fill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#F0B0B0" />
              <stop offset="55%" stopColor="#E8A0A0" />
              <stop offset="100%" stopColor="#B26060" />
            </linearGradient>

            <filter id="phi-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Inner halo — soft pulsing bloom right on the mark. */}
          <motion.circle
            cx={50}
            cy={50}
            r={30}
            fill="url(#phi-halo)"
            animate={{ opacity: [0.55, 1, 0.55], r: [28, 34, 28] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Outer ring — thin burgundy circle. */}
          <motion.circle
            cx={50}
            cy={50}
            r={44}
            fill="none"
            stroke="rgba(232,160,160,0.45)"
            strokeWidth={0.6}
            strokeDasharray="1000"
            initial={{ strokeDashoffset: 1000 }}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />

          {/* Rotating outer tick ring — full 360° CCW, timed to the halo pulse
             so the emphasized marks come around in sync with each glow beat. */}
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            animate={{ rotate: -360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          >
            {Array.from({ length: 12 }).map((_, i) => {
              const angle = (i * 360) / 12;
              return (
                <line
                  key={i}
                  x1={50}
                  y1={4}
                  x2={50}
                  y2={i % 3 === 0 ? 10 : 7}
                  stroke="#E8A0A0"
                  strokeOpacity={i % 3 === 0 ? 0.85 : 0.4}
                  strokeWidth={i % 3 === 0 ? 1.2 : 0.7}
                  strokeLinecap="round"
                  transform={`rotate(${angle} 50 50)`}
                />
              );
            })}
          </motion.g>

          {/* Counter-rotating inner ring. */}
          <motion.circle
            cx={50}
            cy={50}
            r={36}
            fill="none"
            stroke="rgba(232,160,160,0.25)"
            strokeWidth={0.4}
            strokeDasharray="3 4"
            style={{ transformOrigin: "50px 50px" }}
            animate={{ rotate: -360 }}
            transition={{ duration: 34, repeat: Infinity, ease: "linear" }}
          />

          {/* Orbiting dots — two, on opposite phases. */}
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            animate={{ rotate: 360 }}
            transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
          >
            <circle cx={50} cy={12} r={1.6} fill="#F0B0B0" filter="url(#phi-glow)" />
          </motion.g>
          <motion.g
            style={{ transformOrigin: "50px 50px" }}
            animate={{ rotate: -360 }}
            transition={{ duration: 13, repeat: Infinity, ease: "linear" }}
          >
            <circle cx={50} cy={88} r={1.2} fill="#F0B0B0" filter="url(#phi-glow)" opacity={0.75} />
          </motion.g>

          {/* Phi glyph — Greek capital Φ. On-mount fade-up + subtle glow pulse. */}
          <motion.g
            filter="url(#phi-glow)"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.35, ease: "easeOut" }}
          >
            <motion.text
              x={50}
              y={68}
              textAnchor="middle"
              fontFamily="'Cormorant Garamond', Georgia, 'Times New Roman', serif"
              fontSize={56}
              fontWeight={500}
              fill="url(#phi-fill)"
              animate={{ opacity: [0.9, 1, 0.9] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              Φ
            </motion.text>
          </motion.g>
        </svg>
      </motion.div>
    </motion.div>
  );
}
