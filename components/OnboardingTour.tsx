"use client";

import { useCallback, useEffect, useState } from "react";

const TOUR_KEY = "dojo:tourDone";

interface TourStep {
  /** Small uppercase kicker above the heading. */
  kicker: string;
  title: string;
  body: string;
  /** Anchors the card under the topnav and lights the nav strip. */
  pointsAtNav?: boolean;
}

const STEPS: TourStep[] = [
  {
    kicker: "The Threshold",
    title: "Welcome to Suite 7",
    body: "A short walk-through — four beats, then the floor is yours.",
  },
  {
    kicker: "The Map",
    title: "Everything lives up here",
    body: "The Lobby is your homepage — Lessons, The Log, and Homework live up here.",
    pointsAtNav: true,
  },
  {
    kicker: "The Loop",
    title: "How a lesson closes",
    body: "Watch the lesson, submit your homework PDF, your mentor approves, the next floor unlocks.",
  },
  {
    kicker: "The Practice",
    title: "Write daily",
    body: "The Log is private between you and your mentor — write daily, keep the streak.",
  },
];

/**
 * First-visit tour. Four cards, skippable at any point, dismissal remembered
 * in localStorage under `dojo:tourDone`. Mounted from TopNav so it greets a
 * member on whichever dashboard page they land on first.
 *
 * Renders nothing on the server and nothing on the first client paint — the
 * localStorage read happens in an effect, so the markup React hydrates is
 * always the empty case and never mismatches.
 */
export default function OnboardingTour() {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(TOUR_KEY) !== "1") setActive(true);
    } catch {
      // private mode / storage disabled — stay quiet rather than nag
    }
  }, []);

  const dismiss = useCallback(() => {
    setActive(false);
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, dismiss]);

  if (!active) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label="Suite 7 tour">
      {/* Nav highlight — a burgundy wash over the topnav strip instead of a
         real spotlight cut-out. Cheap, and it reads clearly enough. */}
      {current.pointsAtNav ? <div aria-hidden className="tour-nav-glow" /> : null}

      <div className={`tour-card${current.pointsAtNav ? " tour-card-nav" : ""}`}>
        <p className="tour-count">
          {step + 1} / {STEPS.length}
        </p>
        <p className="tour-kicker">{current.kicker}</p>
        <h2>{current.title}</h2>
        <div className="tour-rule" />
        <p className="tour-body">{current.body}</p>

        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={dismiss}>
            Skip
          </button>
          <button
            type="button"
            className="tour-next"
            onClick={() => (last ? dismiss() : setStep((s) => s + 1))}
          >
            {last ? "Begin" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
