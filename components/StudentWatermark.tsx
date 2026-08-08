"use client";

import { useEffect, useState } from "react";

interface StudentWatermarkProps {
  discordId?: string;
  discordUsername?: string;
}

const POSITIONS = [
  { top: "10%", left: "8%" },
  { top: "16%", left: "62%" },
  { top: "44%", left: "16%" },
  { top: "52%", left: "58%" },
  { top: "76%", left: "9%" },
  { top: "78%", left: "64%" },
];

export function watermarkText({
  discordId,
  discordUsername,
}: StudentWatermarkProps): string {
  const username = discordUsername?.trim() || "Discord user";
  const id = discordId?.trim() || "unknown";
  return `${username} • ${id}`;
}

export default function StudentWatermark(props: StudentWatermarkProps) {
  const [step, setStep] = useState(0);
  const [compact, setCompact] = useState(false);
  const text = watermarkText(props);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const updateCompact = () => setCompact(media.matches);
    updateCompact();
    media.addEventListener("change", updateCompact);
    const timer = window.setInterval(
      () => setStep((value) => (value + 1) % POSITIONS.length),
      10_000
    );
    return () => {
      media.removeEventListener("change", updateCompact);
      window.clearInterval(timer);
    };
  }, []);

  const count = compact ? 1 : 2;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 4,
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {Array.from({ length: count }, (_, index) => {
        const position = POSITIONS[(step + index * 3) % POSITIONS.length];
        return (
          <span
            key={index}
            style={{
              position: "absolute",
              top: position.top,
              left: position.left,
              maxWidth: "34%",
              color: "rgba(255,255,255,0.28)",
              fontFamily: "monospace",
              fontSize: compact ? "clamp(9px, 2.4vw, 12px)" : "clamp(10px, 1.2vw, 14px)",
              letterSpacing: "0.06em",
              lineHeight: 1.35,
              textShadow: "0 1px 3px rgba(0,0,0,0.75)",
              overflowWrap: "anywhere",
              transition: "top 1.2s ease, left 1.2s ease",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {text}
          </span>
        );
      })}
    </div>
  );
}
