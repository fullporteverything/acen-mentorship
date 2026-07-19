"use client";

import { motion } from "framer-motion";
import Link from "next/link";

/**
 * Full-screen "cracked gate" error state. Rendered when NextAuth redirects
 * back to / with an ?error=… query param — Discord canceled, guild role
 * missing, provider misconfig, etc. Sits above everything (z-index > the
 * ThresholdOverlay used during a successful cross).
 *
 * Reversible: delete this file, drop the CrackedGate import + `error` prop
 * usage in LoginCard.tsx, and remove `searchParams` from app/page.tsx.
 */
export default function CrackedGate({ code }: { code?: string }) {
  return (
    <motion.div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background:
          "radial-gradient(ellipse at 50% 40%, #180404 0%, #050000 55%, #000000 100%)",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <motion.div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          padding: "0 32px",
          maxWidth: 520,
        }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <CrackedPhi size={220} />

        <motion.p
          style={{
            marginTop: 44,
            fontSize: 11,
            letterSpacing: 5,
            color: "rgba(232,160,160,0.55)",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.7 }}
        >
          The Gate Refused You
        </motion.p>

        <motion.h1
          style={{
            marginTop: 20,
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 32,
            fontWeight: 400,
            color: "#F5F0F0",
            letterSpacing: 1,
            fontStyle: "italic",
            lineHeight: 1.3,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.9 }}
        >
          You&rsquo;re not supposed to be here&hellip;
        </motion.h1>

        {code && (
          <motion.p
            style={{
              marginTop: 18,
              fontSize: 10,
              letterSpacing: 2,
              color: "rgba(245,240,240,0.28)",
              fontFamily: "Georgia, serif",
              textTransform: "uppercase",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.1 }}
          >
            {friendlyCode(code)}
          </motion.p>
        )}

        <motion.div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 14,
            alignItems: "center",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.25 }}
        >
          <Link
            href="/"
            className="btn-discord"
            style={{ padding: "12px 26px", textDecoration: "none" }}
          >
            Try Again
          </Link>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Static, colorless Phi with fracture lines. Deliberately not the same
 * component as PhiLogo — the point is the *absence* of life (no rotation,
 * no halo, no glow). A single ember flickers at the crack junction.
 */
function CrackedPhi({ size = 220 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible" }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      <defs>
        <linearGradient id="crack-fill" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#6a5252" />
          <stop offset="55%" stopColor="#4a3838" />
          <stop offset="100%" stopColor="#251c1c" />
        </linearGradient>
      </defs>

      {/* Outer ring — broken. */}
      <circle
        cx={100}
        cy={100}
        r={88}
        fill="none"
        stroke="rgba(150,120,120,0.35)"
        strokeWidth={0.8}
        strokeDasharray="6 8"
      />

      {/* Fragmented tick marks — half missing, some skewed. */}
      <g stroke="rgba(150,120,120,0.6)" strokeWidth={1.2} strokeLinecap="round">
        {[0, 30, 90, 150, 210, 270].map((a) => (
          <line
            key={a}
            x1={100}
            y1={12}
            x2={100}
            y2={22}
            transform={`rotate(${a} 100 100)`}
          />
        ))}
        {/* Wonky pair — clearly damaged */}
        <line x1={100} y1={12} x2={104} y2={26} transform="rotate(60 100 100)" opacity={0.5} />
        <line x1={100} y1={14} x2={98} y2={20} transform="rotate(180 100 100)" opacity={0.4} />
      </g>

      {/* Phi glyph — desaturated. */}
      <text
        x={100}
        y={140}
        textAnchor="middle"
        fontFamily="'Cormorant Garamond', Georgia, serif"
        fontSize={120}
        fontWeight={500}
        fill="url(#crack-fill)"
      >
        Φ
      </text>

      {/* Fracture lines carving across the glyph. */}
      <g stroke="rgba(20,4,4,0.9)" strokeLinecap="round" fill="none">
        <path d="M 40 60 L 74 90 L 66 106 L 96 128 L 88 148 L 130 170" strokeWidth={1.6} />
        <path d="M 108 74 L 118 96 L 108 110 L 132 138" strokeWidth={1.2} opacity={0.75} />
        <path d="M 74 90 L 60 82" strokeWidth={0.9} opacity={0.55} />
        <path d="M 96 128 L 110 116" strokeWidth={0.9} opacity={0.55} />
      </g>

      {/* Faint red ember at the biggest fracture junction — the last spark. */}
      <motion.circle
        cx={96}
        cy={128}
        r={2.4}
        fill="#c04040"
        style={{ filter: "blur(0.4px)" }}
        animate={{ opacity: [0.15, 0.9, 0.2, 0.6, 0.15] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.svg>
  );
}

function friendlyCode(code: string): string {
  switch (code) {
    case "AccessDenied":
      return "Access denied — role required";
    case "Configuration":
      return "Configuration error";
    case "Verification":
      return "Verification failed";
    case "OAuthAccountNotLinked":
      return "Account not linked";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
      return "Discord sign-in failed";
    default:
      return `Error · ${code}`;
  }
}
