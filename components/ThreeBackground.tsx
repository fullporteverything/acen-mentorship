"use client";

import React from "react";

// 3D flowing silk ribbons — fly across the screen with CSS perspective
interface RibbonProps {
  height: number;
  top: string;
  angle: number;
  tiltX: number;
  delay: number;
  dur: number;
  opacity: number;
}

const RIBBONS: RibbonProps[] = [
  { height: 4,  top: "6%",  angle: -2, tiltX: 14,  delay: 0,    dur: 14, opacity: 0.22 },
  { height: 1,  top: "18%", angle: 5,  tiltX: -8,  delay: 4.5,  dur: 20, opacity: 0.13 },
  { height: 7,  top: "30%", angle: -5, tiltX: 22,  delay: 8,    dur: 12, opacity: 0.17 },
  { height: 2,  top: "43%", angle: 3,  tiltX: -6,  delay: 2,    dur: 22, opacity: 0.11 },
  { height: 5,  top: "57%", angle: -4, tiltX: 16,  delay: 6.5,  dur: 16, opacity: 0.19 },
  { height: 1,  top: "69%", angle: 6,  tiltX: -14, delay: 11,   dur: 25, opacity: 0.09 },
  { height: 8,  top: "79%", angle: -3, tiltX: 20,  delay: 3,    dur: 18, opacity: 0.15 },
  { height: 2,  top: "90%", angle: 4,  tiltX: -10, delay: 7.5,  dur: 21, opacity: 0.10 },
  { height: 3,  top: "13%", angle: -1, tiltX: 9,   delay: 13,   dur: 13, opacity: 0.12 },
  { height: 6,  top: "50%", angle: 2,  tiltX: -18, delay: 9,    dur: 17, opacity: 0.14 },
];

export default function ThreeBackground() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        background: "#EADAC0",
        overflow: "hidden",
        perspective: "600px",
        perspectiveOrigin: "50% 50%",
      }}
    >
      <style>{`
        @keyframes ribbonFly {
          0%   { transform: translateX(-110%) rotateZ(var(--rz)) rotateX(var(--rx)); opacity: 0; }
          8%   { opacity: var(--op); }
          92%  { opacity: var(--op); }
          100% { transform: translateX(115vw) rotateZ(var(--rz)) rotateX(var(--rx)); opacity: 0; }
        }
      `}</style>

      {RIBBONS.map((r, i) => (
        <div
          key={i}
          style={
            {
              position: "absolute",
              left: 0,
              top: r.top,
              width: "100vw",
              height: `${r.height}px`,
              background: `linear-gradient(
                90deg,
                transparent 0%,
                rgba(100,15,15,0.3) 8%,
                rgba(139,26,26,0.7) 25%,
                rgba(120,20,20,0.9) 50%,
                rgba(139,26,26,0.7) 75%,
                rgba(100,15,15,0.3) 92%,
                transparent 100%
              )`,
              boxShadow: `0 0 ${r.height * 3}px rgba(100,15,15,0.15)`,
              "--rz": `${r.angle}deg`,
              "--rx": `${r.tiltX}deg`,
              "--op": r.opacity,
              animation: `ribbonFly ${r.dur}s ease-in-out ${r.delay}s infinite`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
