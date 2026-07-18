"use client";

import React from "react";

// Chinese New Year themed background — hanging lanterns, falling petals, gold sparks

const LANTERNS = [
  { left: "8%",  size: 28, delay: 0,    dur: 6,  glow: 18 },
  { left: "22%", size: 18, delay: 1.5,  dur: 7,  glow: 12 },
  { left: "38%", size: 32, delay: 3,    dur: 5,  glow: 22 },
  { left: "55%", size: 20, delay: 0.8,  dur: 8,  glow: 14 },
  { left: "70%", size: 26, delay: 2.2,  dur: 6,  glow: 18 },
  { left: "85%", size: 16, delay: 4,    dur: 7,  glow: 10 },
  { left: "15%", size: 22, delay: 5,    dur: 9,  glow: 15 },
  { left: "50%", size: 14, delay: 2,    dur: 10, glow: 9  },
  { left: "92%", size: 24, delay: 6,    dur: 6,  glow: 16 },
];

const PETALS = [
  { left: "5%",  delay: 0,    dur: 8,  size: 7,  drift: 40  },
  { left: "15%", delay: 1.2,  dur: 11, size: 5,  drift: -30 },
  { left: "28%", delay: 2.5,  dur: 9,  size: 8,  drift: 50  },
  { left: "40%", delay: 0.7,  dur: 13, size: 4,  drift: -20 },
  { left: "52%", delay: 3.1,  dur: 10, size: 6,  drift: 35  },
  { left: "63%", delay: 1.8,  dur: 7,  size: 9,  drift: -45 },
  { left: "74%", delay: 4.0,  dur: 12, size: 5,  drift: 25  },
  { left: "83%", delay: 2.2,  dur: 8,  size: 7,  drift: -35 },
  { left: "91%", delay: 0.4,  dur: 14, size: 4,  drift: 20  },
  { left: "33%", delay: 5.5,  dur: 9,  size: 6,  drift: -50 },
  { left: "58%", delay: 3.8,  dur: 11, size: 8,  drift: 30  },
  { left: "78%", delay: 6.2,  dur: 8,  size: 5,  drift: -25 },
];

const SPARKS = [
  { left: "10%", top: "15%", delay: 0,   dur: 3  },
  { left: "30%", top: "8%",  delay: 1,   dur: 4  },
  { left: "55%", top: "20%", delay: 0.5, dur: 3  },
  { left: "75%", top: "12%", delay: 2,   dur: 5  },
  { left: "90%", top: "25%", delay: 1.5, dur: 4  },
  { left: "45%", top: "5%",  delay: 2.5, dur: 3  },
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
      }}
    >
      <style>{`
        @keyframes lanternSway {
          0%   { transform: translateY(0px) rotate(-3deg); }
          25%  { transform: translateY(-8px) rotate(2deg); }
          50%  { transform: translateY(-4px) rotate(-2deg); }
          75%  { transform: translateY(-10px) rotate(3deg); }
          100% { transform: translateY(0px) rotate(-3deg); }
        }
        @keyframes petalFall {
          0%   { transform: translateY(-20px) translateX(0) rotate(0deg); opacity: 0; }
          10%  { opacity: 0.8; }
          90%  { opacity: 0.6; }
          100% { transform: translateY(105vh) translateX(var(--drift)) rotate(540deg); opacity: 0; }
        }
        @keyframes sparkPulse {
          0%,100% { opacity: 0; transform: scale(0.5); }
          50%      { opacity: 0.9; transform: scale(1); }
        }
      `}</style>

      {/* Hanging lanterns from top */}
      {LANTERNS.map((l, i) => (
        <div
          key={`lantern-${i}`}
          style={{
            position: "absolute",
            top: 0,
            left: l.left,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            animation: `lanternSway ${l.dur}s ease-in-out ${l.delay}s infinite`,
            transformOrigin: "top center",
          }}
        >
          {/* String */}
          <div style={{
            width: "1px",
            height: `${l.size * 1.5}px`,
            background: `rgba(139,26,26,0.35)`,
          }} />
          {/* Lantern body */}
          <div style={{
            width: `${l.size}px`,
            height: `${l.size * 1.5}px`,
            background: `radial-gradient(ellipse at 35% 35%, rgba(220,60,20,0.95), rgba(160,20,10,0.98))`,
            borderRadius: "50%",
            boxShadow: `0 0 ${l.glow}px rgba(220,80,20,0.5), 0 0 ${l.glow * 2}px rgba(200,50,10,0.2)`,
            position: "relative",
          }}>
            {/* Lantern ribs */}
            {[...Array(4)].map((_, ri) => (
              <div key={ri} style={{
                position: "absolute",
                top: `${20 + ri * 15}%`,
                left: "5%",
                right: "5%",
                height: "1px",
                background: "rgba(180,40,10,0.4)",
                borderRadius: "50%",
              }} />
            ))}
            {/* Gold top cap */}
            <div style={{
              position: "absolute",
              top: "-4px",
              left: "20%",
              right: "20%",
              height: "5px",
              background: "linear-gradient(90deg, rgba(180,140,20,0.8), rgba(220,180,40,0.9), rgba(180,140,20,0.8))",
              borderRadius: "2px",
            }} />
            {/* Gold bottom cap */}
            <div style={{
              position: "absolute",
              bottom: "-4px",
              left: "20%",
              right: "20%",
              height: "5px",
              background: "linear-gradient(90deg, rgba(180,140,20,0.8), rgba(220,180,40,0.9), rgba(180,140,20,0.8))",
              borderRadius: "2px",
            }} />
          </div>
          {/* Tassel */}
          <div style={{
            width: "1px",
            height: `${l.size * 0.6}px`,
            background: "rgba(180,140,20,0.6)",
          }} />
          <div style={{
            width: `${l.size * 0.3}px`,
            height: `${l.size * 0.3}px`,
            borderRadius: "50%",
            background: "rgba(200,160,30,0.5)",
          }} />
        </div>
      ))}

      {/* Falling petals */}
      {PETALS.map((p, i) => (
        <div
          key={`petal-${i}`}
          style={{
            position: "absolute",
            top: "-20px",
            left: p.left,
            width: `${p.size}px`,
            height: `${p.size * 0.7}px`,
            background: `radial-gradient(ellipse, rgba(196,24,24,0.7) 0%, rgba(220,60,40,0.4) 60%, transparent 100%)`,
            borderRadius: "50% 0 50% 0",
            "--drift": `${p.drift}px`,
            animation: `petalFall ${p.dur}s ease-in ${p.delay}s infinite`,
          } as React.CSSProperties}
        />
      ))}

      {/* Gold spark accents */}
      {SPARKS.map((s, i) => (
        <div
          key={`spark-${i}`}
          style={{
            position: "absolute",
            top: s.top,
            left: s.left,
            width: "4px",
            height: "4px",
            borderRadius: "50%",
            background: "rgba(220,180,40,0.9)",
            boxShadow: "0 0 6px rgba(220,180,40,0.6), 0 0 12px rgba(220,160,20,0.3)",
            animation: `sparkPulse ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

      {/* Subtle red glow at bottom */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "120px",
        background: "linear-gradient(to top, rgba(196,24,24,0.06) 0%, transparent 100%)",
        pointerEvents: "none",
      }} />
    </div>
  );
}
