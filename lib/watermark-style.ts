import type { CSSProperties } from "react";

export function watermarkLabelStyle(compact: boolean): CSSProperties {
  return {
    position: "absolute",
    maxWidth: "38%",
    color: "rgba(255,255,255,0.72)",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    fontSize: compact
      ? "clamp(10px, 2.6vw, 13px)"
      : "clamp(11px, 1.25vw, 15px)",
    fontWeight: 700,
    letterSpacing: "0.035em",
    lineHeight: 1.25,
    WebkitTextStroke: "0.45px rgba(0,0,0,0.9)",
    textShadow:
      "-1px 0 0 rgba(0,0,0,0.9), 1px 0 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.9)",
    overflowWrap: "anywhere",
    pointerEvents: "none",
    userSelect: "none",
  };
}

/**
 * Which name goes on a lesson watermark.
 *
 * ALWAYS the Discord @handle when we have it, never the display name.
 *
 * Auth.js's Discord provider fills `name` from `global_name ?? username`, so
 * `session.user.name` is the display name — which a member can change at any
 * moment, and which is NOT unique across Discord. Two members can share one,
 * and a member can set theirs to somebody else's. A watermark whose whole job
 * is to say who leaked a lesson cannot rest on a field like that: it would name
 * an innocent person as readily as the guilty one.
 *
 * The @handle has been unique platform-wide since Discord retired
 * discriminators in 2023, and it cannot be edited into someone else's.
 *
 * The display-name fallback exists only for sessions issued before the handle
 * was captured; those age out within the 8-hour session lifetime.
 */
export function watermarkName(identity: {
  username?: string | null;
  name?: string | null;
}): string {
  return (
    identity.username?.trim() ||
    identity.name?.trim() ||
    "Discord user"
  );
}
