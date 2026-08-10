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
