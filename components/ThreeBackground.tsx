"use client";

import React from "react";

interface KanjiItem {
  char: string;
  size: string;
  left: string;
  top: string;
  opacity: number;
  dur: number;
  delay: number;
  drift: number;
}

// Kanji: 道 way/path · 場 place/dojo · 師 master · 勝 victory · 錬 forge/training
//        武 martial · 心 heart/mind · 極 ultimate · 覚 awakening · 剣 sword
//        力 power · 精 spirit/precision · 義 righteousness · 闘 fight
const KANJI_DATA: KanjiItem[] = [
  { char: "道", size: "18rem", left: "7%",  top: "11%", opacity: 0.11, dur: 25, delay: 0,  drift: -22 },
  { char: "場", size: "14rem", left: "72%", top: "5%",  opacity: 0.07, dur: 33, delay: 5,  drift: 16  },
  { char: "師", size: "10rem", left: "17%", top: "63%", opacity: 0.09, dur: 20, delay: 8,  drift: -12 },
  { char: "勝", size: "16rem", left: "57%", top: "51%", opacity: 0.07, dur: 36, delay: 2,  drift: 18  },
  { char: "錬", size: "12rem", left: "81%", top: "31%", opacity: 0.10, dur: 22, delay: 12, drift: -10 },
  { char: "武", size: "24rem", left: "35%", top: "17%", opacity: 0.04, dur: 44, delay: 3,  drift: 10  },
  { char: "心", size: "9rem",  left: "4%",  top: "79%", opacity: 0.10, dur: 18, delay: 7,  drift: -16 },
  { char: "極", size: "13rem", left: "47%", top: "73%", opacity: 0.07, dur: 29, delay: 15, drift: 12  },
  { char: "覚", size: "11rem", left: "27%", top: "4%",  opacity: 0.09, dur: 31, delay: 1,  drift: -9  },
  { char: "剣", size: "15rem", left: "85%", top: "64%", opacity: 0.06, dur: 26, delay: 9,  drift: 20  },
  { char: "力", size: "21rem", left: "13%", top: "37%", opacity: 0.04, dur: 50, delay: 11, drift: -18 },
  { char: "精", size: "11rem", left: "67%", top: "84%", opacity: 0.08, dur: 24, delay: 4,  drift: 11  },
  { char: "義", size: "9rem",  left: "42%", top: "89%", opacity: 0.08, dur: 19, delay: 13, drift: -14 },
  { char: "道", size: "8rem",  left: "62%", top: "17%", opacity: 0.14, dur: 16, delay: 6,  drift: 6   },
  { char: "闘", size: "17rem", left: "2%",  top: "19%", opacity: 0.05, dur: 40, delay: 10, drift: 14  },
];

export default function KanjiBackground() {
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
        @keyframes kanjiDrift {
          0%, 100% {
            transform: translateY(0px);
            opacity: var(--k-hi);
          }
          50% {
            transform: translateY(var(--k-drift));
            opacity: var(--k-lo);
          }
        }
      `}</style>

      {KANJI_DATA.map((k, i) => (
        <div
          key={i}
          style={
            {
              position: "absolute",
              left: k.left,
              top: k.top,
              fontSize: k.size,
              color: "#8B1A1A",
              fontFamily: "Georgia, 'Times New Roman', serif",
              userSelect: "none",
              pointerEvents: "none",
              lineHeight: 1,
              "--k-hi": k.opacity,
              "--k-lo": k.opacity * 0.25,
              "--k-drift": `${k.drift}px`,
              animation: `kanjiDrift ${k.dur}s ease-in-out ${k.delay}s infinite`,
            } as React.CSSProperties
          }
        >
          {k.char}
        </div>
      ))}
    </div>
  );
}
