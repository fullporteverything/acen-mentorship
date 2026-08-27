import type { SessionSighting } from "./session-types";

/**
 * SUITE 7 — PER-ACCOUNT BASELINE.
 *
 * The anomaly scorer on its own asks "is this odd in the absolute?", with one
 * set of thresholds for everybody. That forces the thresholds to be as
 * forgiving as the most unusual member on the roster: two devices has to score
 * zero, because across a whole membership two devices is usually just a browser
 * update. The member who has used one laptop since January gets the same
 * allowance as the one with a laptop, a phone and a tablet.
 *
 * A baseline replaces that with "is this odd FOR THIS ACCOUNT?" — and it cuts
 * both ways, which is the point:
 *
 *   Fewer false positives — a genuine three-device member establishes three
 *   devices as their normal within a week and stops tripping anything.
 *
 *   More true positives — sharing starts on a particular day, so it shows up
 *   as a departure from a settled profile. Absolute thresholds cannot see that
 *   at all.
 *
 * ── THE RULE THAT DOES MOST OF THE WORK ─────────────────────────────────────
 * A device this account has used before is not a new device. A browser update
 * mints a fresh fingerprint, but the OLD one stops appearing at the same time —
 * one device in, one device out. Someone else logging in is different in shape:
 * an unfamiliar fingerprint shows up WHILE the familiar ones are still active.
 * Counting unknown-and-concurrent rather than merely distinct is what separates
 * those two, and it is why this module exists.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Days of history before a profile is trusted enough to score against. Below
 * this the absolute thresholds stay in charge — a baseline built from two days
 * is just the last two days wearing a lab coat, and a member on holiday when
 * they joined would have their quietest week treated as their norm forever.
 */
export const BASELINE_WARMUP_DAYS = 7;

/** How much history a rebuild reads. */
export const BASELINE_WINDOW_DAYS = 30;

/**
 * A profile may only widen by one device per rebuild. Slow to accept, quick to
 * forget: without this, an account being shared from day one simply teaches the
 * baseline that five devices is normal and the watch never fires again. One
 * step a day means a genuine new laptop is absorbed within a day or two, while
 * a sudden jump to five stays visible for long enough to be seen.
 */
export const BASELINE_MAX_GROWTH_PER_REBUILD = 1;

/** Caps on the remembered sets, so one account cannot bloat a row unboundedly. */
export const MAX_KNOWN_FINGERPRINTS = 12;
export const MAX_KNOWN_COUNTRIES = 8;

export interface SessionBaseline {
  /** Distinct calendar days of history behind this profile. */
  observedDays: number;
  /** Usual peak distinct devices inside one co-occurrence window. */
  typicalDevices: number;
  typicalIps: number;
  typicalCountries: number;
  /** Distinct sign-ins on a normal day for this account. */
  typicalSessionsPerDay: number;
  /** Fingerprints this account has genuinely used, most recent first. */
  knownFingerprints: string[];
  knownCountries: string[];
}

export const EMPTY_BASELINE: SessionBaseline = {
  observedDays: 0,
  typicalDevices: 0,
  typicalIps: 0,
  typicalCountries: 0,
  typicalSessionsPerDay: 0,
  knownFingerprints: [],
  knownCountries: [],
};

/** True once the profile has enough history to be scored against. */
export function baselineIsWarm(baseline: SessionBaseline | null): boolean {
  return (baseline?.observedDays ?? 0) >= BASELINE_WARMUP_DAYS;
}

interface Row {
  t: number;
  ip: string | null;
  country: string | null;
  fingerprint: string | null;
  sessionId: string | null;
}

function normalise(sightings: SessionSighting[]): Row[] {
  return sightings
    .map((s) => ({
      t: Date.parse(s.at),
      ip: s.ip?.trim() || null,
      country: s.country?.trim().toUpperCase() || null,
      fingerprint: s.fingerprint?.trim() || null,
      sessionId: s.sessionId?.trim() || null,
    }))
    .filter((s) => Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
}

/** UTC day key, so "distinct days" doesn't drift with the member's timezone. */
function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Peak distinct non-null values inside any one window, per day, then the median
 * across days.
 *
 * The MEDIAN and not the max, deliberately: one strange afternoon should not
 * become the account's permanent allowance. If sharing happened on three days
 * out of thirty, the median still reflects the other twenty-seven.
 */
function typicalPerDay(
  rows: Row[],
  windowMs: number,
  pick: (row: Row) => string | null
): number {
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const key = dayKey(row.t);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(row);
    else byDay.set(key, [row]);
  }

  const peaks: number[] = [];
  for (const dayRows of byDay.values()) {
    let best = 0;
    for (let i = 0; i < dayRows.length; i++) {
      const seen = new Set<string>();
      for (let j = i; j < dayRows.length && dayRows[j].t - dayRows[i].t <= windowMs; j++) {
        const value = pick(dayRows[j]);
        if (value) seen.add(value);
      }
      if (seen.size > best) best = seen.size;
    }
    peaks.push(best);
  }

  if (peaks.length === 0) return 0;
  peaks.sort((a, b) => a - b);
  return peaks[Math.floor(peaks.length / 2)];
}

/** Median across days of the distinct non-null values seen on each day. */
function medianPerDay(rows: Row[], pick: (row: Row) => string | null): number {
  const byDay = new Map<string, Set<string>>();
  for (const row of rows) {
    const value = pick(row);
    if (!value) continue;
    const key = dayKey(row.t);
    const bucket = byDay.get(key);
    if (bucket) bucket.add(value);
    else byDay.set(key, new Set([value]));
  }
  const counts = [...byDay.values()].map((set) => set.size).sort((a, b) => a - b);
  return counts.length ? counts[Math.floor(counts.length / 2)] : 0;
}

/** Distinct values, most recently seen first, capped. */
function recentDistinct(
  rows: Row[],
  pick: (row: Row) => string | null,
  cap: number
): string[] {
  const lastSeen = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row);
    if (value) lastSeen.set(value, row.t);
  }
  return [...lastSeen.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([value]) => value);
}

/**
 * Rebuilds an account's profile from its sighting history.
 *
 * Pure: same history and same previous profile always give the same result, so
 * a rebuild is restartable and the whole thing is testable without a database.
 * `previous` is used only to rate-limit growth — see
 * BASELINE_MAX_GROWTH_PER_REBUILD.
 */
export function computeBaseline(
  sightings: SessionSighting[],
  options: { windowMs: number; previous?: SessionBaseline | null }
): SessionBaseline {
  const rows = normalise(sightings ?? []);
  if (rows.length === 0) return EMPTY_BASELINE;

  const observedDays = new Set(rows.map((row) => dayKey(row.t))).size;
  const rawDevices = typicalPerDay(rows, options.windowMs, (r) => r.fingerprint);
  const previous = options.previous;

  // Growth is capped; shrinking is not. An account that stops using a device
  // should tighten back down immediately, because the looser number was only
  // ever an allowance we extended on evidence that has now gone.
  const typicalDevices =
    previous && previous.observedDays > 0
      ? Math.min(rawDevices, previous.typicalDevices + BASELINE_MAX_GROWTH_PER_REBUILD)
      : rawDevices;

  return {
    observedDays,
    typicalDevices,
    typicalIps: typicalPerDay(rows, options.windowMs, (r) => r.ip),
    typicalCountries: typicalPerDay(rows, options.windowMs, (r) => r.country),
    // Whole-day count, not a windowed peak: the question is how often this
    // person signs in across a day, not how many seats overlap (one-seat
    // enforcement already guarantees the answer to that is one).
    typicalSessionsPerDay: medianPerDay(rows, (r) => r.sessionId),
    knownFingerprints: recentDistinct(rows, (r) => r.fingerprint, MAX_KNOWN_FINGERPRINTS),
    knownCountries: recentDistinct(rows, (r) => r.country, MAX_KNOWN_COUNTRIES),
  };
}
