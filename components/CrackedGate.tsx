"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import Link from "next/link";
import SupportLink from "@/components/SupportLink";

/**
 * Full-screen "cracked gate" error state. Rendered when NextAuth redirects
 * back to / with an ?error=… query param — Discord canceled, guild role
 * missing, provider misconfig, etc. Sits above everything (z-index > the
 * ThresholdOverlay used during a successful cross).
 *
 * Reversible: delete this file, drop the CrackedGate import + `error` prop
 * usage in LoginCard.tsx, and remove `searchParams` from app/page.tsx.
 */
export default function CrackedGate({
  code,
  resetToken,
  signOutAction,
}: {
  code?: string;
  /**
   * Signed, five-minute, single-account proof that Discord just authenticated
   * this visitor — minted in the sign-in callback, and ONLY when the refusal
   * was "your account is already open elsewhere". Its presence is what gates
   * the clear-my-sessions button, and the account it clears is the one sealed
   * inside it, so a student can never reach another student's sessions.
   */
  resetToken?: string;
  /** Server action that signs out then lands on a clean login page. */
  signOutAction?: () => Promise<void>;
}) {
  const copy = gateCopy(code);
  /**
   * A session gate does not fade in.
   *
   * The cracked-gate drama belongs to "we don't know you" — it earns its
   * entrance. Being told your account is already open somewhere is a full
   * stop, and a screen that eases itself in over a second and a half reads as
   * decoration you might be able to wait out or click past. `initial={false}`
   * makes framer-motion skip the entrance entirely: it is simply there, already
   * finished, the moment the page paints.
   */
  const instant = code === "SessionActive" || code === "SessionExpired";
  // Offered only on the too-many-sessions refusal, and only when a token
  // actually came with it. No token, no button — there would be nothing to
  // prove who is asking.
  const canClear = code === "SessionActive" && Boolean(resetToken);
  return (
    <motion.div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: instant
          ? "#000000"
          : "radial-gradient(ellipse at 50% 40%, #180404 0%, #050000 55%, #000000 100%)",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
      initial={instant ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {/* This gate paints over the login page, wordmark and all, so a session
          refusal would otherwise be unbranded black. Put it back. */}
      {instant && (
        <div className="brand-vertical" aria-hidden>
          Suite 7&nbsp;&nbsp;Mentorship
        </div>
      )}
      <motion.div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          padding: "0 32px",
          maxWidth: 520,
        }}
        initial={instant ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* The fractured Φ is reserved for genuine "we don't know you"
            failures. A member waiting on a role hasn't broken anything —
            showing them a shattered gate reads as an accusation. */}
        {copy.showArt && <CrackedPhi size={220} />}

        <motion.p
          style={{
            marginTop: copy.showArt ? 44 : 0,
            fontSize: instant ? 13 : 11,
            letterSpacing: instant ? 4 : 5,
            // Crimson for a refusal, gold for everything else. Gold is the
            // site's ordinary voice and this is not an ordinary message.
            color: instant ? "#b21d3b" : "rgba(231,192,113,0.55)",
            fontVariant: instant ? "small-caps" : undefined,
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
          }}
          initial={instant ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.7 }}
        >
          {copy.label}
        </motion.p>

        <motion.h1
          style={{
            marginTop: instant ? 26 : 20,
            fontFamily: instant
              ? "Georgia, Cambria, 'Times New Roman', serif"
              : "'Cormorant Garamond', Georgia, serif",
            fontSize: instant ? 19 : 32,
            fontWeight: 400,
            color: instant ? "rgba(245,240,240,0.92)" : "#F5F0F0",
            letterSpacing: instant ? 0.6 : 1,
            fontStyle: instant ? "normal" : "italic",
            lineHeight: instant ? 1.7 : 1.3,
          }}
          initial={instant ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.9 }}
        >
          {copy.headline}
        </motion.h1>

        {copy.subline && (
          <motion.p
            style={{
              marginTop: 18,
              maxWidth: 440,
              fontFamily: "Georgia, serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "rgba(245,240,240,0.62)",
            }}
            initial={instant ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.05 }}
          >
            {copy.subline}
          </motion.p>
        )}

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
            initial={instant ? false : { opacity: 0 }}
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
          initial={instant ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.25 }}
        >
          {signOutAction ? (
            /* Sign out first — a still-signed-in visitor who just followed a
               plain "/" link would bounce straight back into the failing
               dashboard and land here again. */
            <form action={signOutAction}>
              <button
                type="submit"
                className="btn-discord"
                style={{ padding: "12px 26px" }}
              >
                Try Again
              </button>
            </form>
          ) : (
            <Link
              href="/"
              className="btn-discord"
              style={{ padding: "12px 26px", textDecoration: "none" }}
            >
              Try Again
            </Link>
          )}
          <SupportLink>Get access help</SupportLink>
        </motion.div>

        {canClear && <ClearSessions token={resetToken!} />}
      </motion.div>
    </motion.div>
  );
}

/**
 * "Sign me out everywhere" — the member's own way out of a stuck session,
 * without waiting for the idle window or asking an administrator.
 *
 * The token is the authority here, not this component: it is signed, it is
 * bound to one account, and the endpoint reads the account from INSIDE it, so
 * nothing rendered or typed on this page can point it at anybody else.
 */
function ClearSessions({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [message, setMessage] = useState("");

  async function clear() {
    if (state === "working" || state === "done") return;
    setState("working");
    try {
      const res = await fetch("/api/security/session/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setState("failed");
        setMessage(
          typeof data?.error === "string"
            ? data.error
            : "Could not clear your sessions."
        );
        return;
      }
      setState("done");
      // Straight back to a clean sign-in. `replace` so the browser Back button
      // cannot return to a gate whose token has now been spent.
      window.location.replace("/");
    } catch {
      setState("failed");
      setMessage("Could not reach the server. Try again.");
    }
  }

  return (
    <div style={{ marginTop: 26, textAlign: "center" }}>
      <button
        type="button"
        onClick={clear}
        disabled={state === "working" || state === "done"}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          color: "rgba(245,240,240,0.5)",
          fontFamily: "Georgia, serif",
          fontSize: 12,
          letterSpacing: 1.4,
          textDecoration: "underline",
          textUnderlineOffset: 5,
          cursor: state === "working" ? "default" : "pointer",
        }}
      >
        {state === "working"
          ? "Signing out everywhere…"
          : state === "done"
            ? "Signed out — returning…"
            : "Sign out of all my sessions"}
      </button>
      {state === "failed" && (
        <p
          style={{
            marginTop: 12,
            fontFamily: "Georgia, serif",
            fontSize: 12,
            color: "#b21d3b",
          }}
        >
          {message}
        </p>
      )}
    </div>
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

interface GateCopy {
  /** Small-caps kicker above the headline. */
  label: string;
  headline: string;
  /** Plain-language explanation — only for refusals we can actually explain. */
  subline?: string;
  showArt: boolean;
}

/**
 * The sign-in callback redirects here with a code that names the real reason
 * (see auth.ts). Two of them are recoverable situations, not intrusions, so
 * they get their own reassuring copy instead of the cracked gate.
 */
function gateCopy(code?: string): GateCopy {
  switch (code) {
    case "NotInServer":
      return {
        label: "The Gate Refused You",
        headline: "Suite 7 doesn’t know you yet.",
        subline:
          "This Discord account isn’t in the Suite 7 server yet — join first, then sign in again.",
        showArt: false,
      };
    // One live session per account. The newcomer is refused rather than the
    // session already in use being booted — so this is a member with two
    // browsers open far more often than it is anything sinister. No cracked
    // gate: nothing was broken, and it clears itself within minutes.
    case "SessionActive":
      return {
        label: "Session limit reached",
        headline: "You already have an active session.",
        subline: "Please close the other browser or device first.",
        showArt: false,
      };
    // Nobody took their seat and nobody kicked them — their sign-in simply
    // predates seat tracking, or the eight-hour session ran out. Say that
    // plainly; implying something went wrong would have members messaging the
    // admin about a working site.
    case "SessionExpired":
      return {
        label: "Sign In Again",
        headline: "Your session has ended.",
        subline:
          "Sessions last a single sitting rather than staying open indefinitely. Sign in with Discord to pick up where you left off.",
        showArt: false,
      };
    case "RoleMissing":
    // A plain AccessDenied is almost always this same case arriving without a
    // reason code, so it gets the same benefit of the doubt.
    case "AccessDenied":
      return {
        label: "The gate hasn’t opened yet",
        headline: "Almost through.",
        subline:
          "You’re signed in, but the mentorship role isn’t on your Discord account yet. Ping the admin — you’ll be let in.",
        showArt: false,
      };
    default:
      return {
        label: "The Gate Refused You",
        headline: "You’re not supposed to be here…",
        showArt: true,
      };
  }
}

function friendlyCode(code: string): string {
  switch (code) {
    case "NotInServer":
      return "Not a member of the Discord server";
    case "SessionActive":
      return "Another session is already signed in";
    case "SessionExpired":
      return "Session ended — sign in again";
    case "RoleMissing":
      return "Mentorship role not assigned yet";
    case "AccessDenied":
      return "Mentorship role required";
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
      return "Discord sign-in could not be completed";
  }
}
