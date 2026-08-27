import { describe, expect, it } from "vitest";

import {
  BASELINE_MAX_GROWTH_PER_REBUILD,
  BASELINE_WARMUP_DAYS,
  EMPTY_BASELINE,
  MAX_KNOWN_FINGERPRINTS,
  baselineIsWarm,
  computeBaseline,
} from "./session-baseline";
import type { SessionSighting } from "./session-types";

const WINDOW_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-07-01T09:00:00.000Z");

function sighting(
  dayOffset: number,
  minute: number,
  fingerprint: string | null,
  extra: { ip?: string; country?: string; sessionId?: string } = {}
): SessionSighting {
  return {
    at: new Date(T0 + dayOffset * DAY_MS + minute * 60_000).toISOString(),
    ip: extra.ip ?? "203.0.113.10",
    country: extra.country ?? "DE",
    fingerprint,
    sessionId: extra.sessionId ?? `seat-${dayOffset}`,
  };
}

/** A settled one-laptop member: the population norm this site is built for. */
function steadyLaptop(days = 14): SessionSighting[] {
  const rows: SessionSighting[] = [];
  for (let day = 0; day < days; day++) {
    rows.push(sighting(day, 0, "fp-laptop"));
    rows.push(sighting(day, 20, "fp-laptop"));
    rows.push(sighting(day, 200, "fp-laptop"));
  }
  return rows;
}

describe("baseline warm-up", () => {
  it("is cold with no history at all", () => {
    expect(baselineIsWarm(null)).toBe(false);
    expect(baselineIsWarm(EMPTY_BASELINE)).toBe(false);
  });

  it(`stays cold below ${BASELINE_WARMUP_DAYS} days, so a short history never scores anyone`, () => {
    const baseline = computeBaseline(steadyLaptop(BASELINE_WARMUP_DAYS - 1), {
      windowMs: WINDOW_MS,
    });

    expect(baseline.observedDays).toBe(BASELINE_WARMUP_DAYS - 1);
    expect(baselineIsWarm(baseline)).toBe(false);
  });

  it(`warms at exactly ${BASELINE_WARMUP_DAYS} days`, () => {
    const baseline = computeBaseline(steadyLaptop(BASELINE_WARMUP_DAYS), {
      windowMs: WINDOW_MS,
    });

    expect(baselineIsWarm(baseline)).toBe(true);
  });
});

describe("what the profile learns", () => {
  it("settles a one-laptop member at one device", () => {
    const baseline = computeBaseline(steadyLaptop(), { windowMs: WINDOW_MS });

    expect(baseline.typicalDevices).toBe(1);
    expect(baseline.knownFingerprints).toEqual(["fp-laptop"]);
  });

  it("learns three devices for a member who genuinely uses three", () => {
    const rows: SessionSighting[] = [];
    for (let day = 0; day < 14; day++) {
      rows.push(sighting(day, 0, "fp-laptop"));
      rows.push(sighting(day, 5, "fp-phone"));
      rows.push(sighting(day, 10, "fp-tablet"));
    }

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.typicalDevices).toBe(3);
    expect(baseline.knownFingerprints).toEqual(
      expect.arrayContaining(["fp-laptop", "fp-phone", "fp-tablet"])
    );
  });

  it("takes the MEDIAN day, so one strange afternoon is not adopted as normal", () => {
    const rows = steadyLaptop(14);
    // One outlier day with four devices at once.
    rows.push(sighting(20, 0, "fp-a"));
    rows.push(sighting(20, 2, "fp-b"));
    rows.push(sighting(20, 4, "fp-c"));
    rows.push(sighting(20, 6, "fp-d"));

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.typicalDevices).toBe(1);
  });

  it("counts a browser update as one device, not two", () => {
    // The old fingerprint stops the day the new one starts — one in, one out.
    const rows: SessionSighting[] = [];
    for (let day = 0; day < 7; day++) rows.push(sighting(day, 0, "fp-chrome-138"));
    for (let day = 7; day < 14; day++) rows.push(sighting(day, 0, "fp-chrome-139"));

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.typicalDevices).toBe(1);
    // Both are remembered as known, which is what stops the NEW one from
    // reading as a stranger the day it appears.
    expect(baseline.knownFingerprints).toEqual(
      expect.arrayContaining(["fp-chrome-138", "fp-chrome-139"])
    );
  });

  it("learns the account's normal sign-in rate", () => {
    const rows: SessionSighting[] = [];
    for (let day = 0; day < 14; day++) {
      rows.push(sighting(day, 0, "fp-laptop", { sessionId: `d${day}-morning` }));
      rows.push(sighting(day, 400, "fp-laptop", { sessionId: `d${day}-evening` }));
    }

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.typicalSessionsPerDay).toBe(2);
  });
});

describe("growth rate limiting — the anti-training guard", () => {
  it("widens by at most one device per rebuild", () => {
    const rows: SessionSighting[] = [];
    for (let day = 0; day < 14; day++) {
      for (const fp of ["fp-a", "fp-b", "fp-c", "fp-d", "fp-e"]) {
        rows.push(sighting(day, 0, fp));
      }
    }

    // An account being shared from day one would otherwise simply teach the
    // profile that five devices is normal, and the watch would never fire.
    const baseline = computeBaseline(rows, {
      windowMs: WINDOW_MS,
      previous: { ...EMPTY_BASELINE, observedDays: 30, typicalDevices: 1 },
    });

    expect(baseline.typicalDevices).toBe(1 + BASELINE_MAX_GROWTH_PER_REBUILD);
  });

  it("shrinks immediately when a device stops being used", () => {
    // Growth is capped; shrinking is not. The looser allowance was only ever
    // extended on evidence, and that evidence has gone.
    const baseline = computeBaseline(steadyLaptop(), {
      windowMs: WINDOW_MS,
      previous: { ...EMPTY_BASELINE, observedDays: 30, typicalDevices: 4 },
    });

    expect(baseline.typicalDevices).toBe(1);
  });

  it("does not rate-limit the very first build", () => {
    const rows: SessionSighting[] = [];
    for (let day = 0; day < 14; day++) {
      rows.push(sighting(day, 0, "fp-a"));
      rows.push(sighting(day, 2, "fp-b"));
      rows.push(sighting(day, 4, "fp-c"));
    }

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS, previous: null });

    expect(baseline.typicalDevices).toBe(3);
  });
});

describe("bounds and degenerate input", () => {
  it("returns the empty profile for no history", () => {
    expect(computeBaseline([], { windowMs: WINDOW_MS })).toEqual(EMPTY_BASELINE);
  });

  it("ignores unparseable timestamps rather than guessing", () => {
    const rows: SessionSighting[] = [
      { at: "not-a-date", ip: null, country: null, fingerprint: "fp-x", sessionId: "s" },
      ...steadyLaptop(8),
    ];

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.observedDays).toBe(8);
    expect(baseline.knownFingerprints).not.toContain("fp-x");
  });

  it(`caps remembered fingerprints at ${MAX_KNOWN_FINGERPRINTS}`, () => {
    const rows: SessionSighting[] = [];
    for (let i = 0; i < 40; i++) rows.push(sighting(i % 14, i, `fp-${i}`));

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.knownFingerprints).toHaveLength(MAX_KNOWN_FINGERPRINTS);
  });

  it("never counts a missing fingerprint as a device", () => {
    const rows: SessionSighting[] = [];
    for (let day = 0; day < 10; day++) {
      rows.push(sighting(day, 0, null));
      rows.push(sighting(day, 5, "fp-laptop"));
    }

    const baseline = computeBaseline(rows, { windowMs: WINDOW_MS });

    expect(baseline.typicalDevices).toBe(1);
    expect(baseline.knownFingerprints).toEqual(["fp-laptop"]);
  });
});
