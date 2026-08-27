import { baselineIsWarm, type SessionBaseline } from "./session-baseline";
import {
  ANOMALY_REVOKE_SCORE,
  type AnomalySignal,
  type AnomalyVerdict,
  type SessionSighting,
} from "./session-types";

/**
 * Scores how odd an account's recent heartbeat history looks.
 *
 * Pure and dependency-free on purpose: the whole point is that the rule that
 * can cost somebody their access is readable and unit-testable in isolation.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FUNCTION CANNOT KNOW
 *
 * Every input here is a weak proxy, and each one has a boring, innocent
 * explanation that is far more common than account sharing:
 *
 *   ip           A phone walking out of the house swaps wifi for cellular and
 *                changes IP. Carrier-grade NAT re-routes it again minutes
 *                later. A university, an office or a hotel puts thousands of
 *                unrelated people behind ONE address. So neither "many IPs"
 *                nor "one IP" tells us how many humans are involved.
 *
 *   country      This is the country of the IP's egress point, not of the
 *                person. Mobile carriers regularly egress in a neighbouring
 *                country; a VPN egresses wherever it likes; a member who
 *                actually travels changes country legitimately.
 *
 *   fingerprint  An opaque browser hash. It changes on a browser update, a
 *                new extension, a font install, a resolution change — without
 *                a second human being anywhere near the account. Two devices
 *                CAN also collide on one hash. It is a signal, never an
 *                identity (see lib/session-types.ts).
 *
 *   datacenterIp Says the traffic left a hosting range. Every commercial VPN
 *                looks exactly like this, and using a VPN is not cheating.
 *
 * The lesson carried over from lib/discord-membership.ts applies in spirit:
 * a technical observation about infrastructure is not an authoritative verdict
 * about a person. So no single signal below can reach ANOMALY_REVOKE_SCORE on
 * its own — the score only clears the bar when several independent signals,
 * whose innocent explanations are DIFFERENT from each other, agree at once.
 * That co-occurrence — several distinct devices, in several distinct places,
 * inside the same few minutes — is the actual shape of a shared login.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Nothing is scored below this many heartbeats. Two sightings are an anecdote,
 * not a pattern, and the cost of being wrong here is a paying member losing
 * access they bought.
 */
const MIN_SIGHTINGS = 3;

/**
 * Signals only count when they CO-OCCUR. Counting distinct devices or
 * countries across a whole day would flag every commuter; counting them inside
 * half an hour is what makes "these cannot all be the same person right now"
 * even arguable.
 */
const CO_OCCURRENCE_WINDOW_MS = 30 * 60_000;

/**
 * Weights. Deliberately chosen so that:
 *   - the largest single contribution (45) is well below the revoke bar (70);
 *   - devices outweigh IPs, because distinct fingerprints in half an hour have
 *     far fewer innocent explanations than distinct IPs do (see above);
 *   - two of the three network-shaped signals still cannot reach the bar
 *     without the device signal joining them.
 */
const WEIGHTS = {
  /** Distinct fingerprints inside the window. 2 scores nothing: that is the browser-update case. */
  devices: { 3: 28, 4: 40, 5: 45 },
  /**
   * Fingerprints this account has NEVER used, co-occurring with familiar ones.
   * Only ever applied to a warm baseline. Weighted at a lower count than the
   * absolute tier because "unknown on a settled profile" is much stronger
   * evidence than "distinct on an account we know nothing about" — but still
   * capped below the revoke bar, so it cannot act alone.
   */
  unknownDevices: { 2: 30, 3: 45 },
  /**
   * Devices BEYOND this account's own established normal. Warm baseline only.
   * Catches the case where the extra devices are all individually familiar but
   * there are suddenly more of them at once than this account has ever shown.
   */
  excessDevices: { 2: 28, 3: 40, 4: 45 },
  /** Distinct IPs inside the window. 3 scores nothing: that is an afternoon of mobile data. */
  ips: { 4: 10, 6: 18 },
  /** Distinct countries inside the window. Coarse — see the comment on the signal below. */
  countries: { 2: 15, 3: 30 },
  /**
   * Sign-ins today as a MULTIPLE of this account's normal day. Warm baseline
   * only. Modest on purpose: a member who is genuinely busy, or bouncing
   * between two of their own machines, churns sessions innocently — this is
   * corroboration, never a case on its own.
   */
  sessionChurn: { 3: 15, 5: 25 },
  /** Hosting/VPN egress. Kept small: it is a lifestyle choice, not evidence. */
  datacenter: 10,
} as const;

interface Timed {
  t: number;
  ip: string | null;
  country: string | null;
  fingerprint: string | null;
  sessionId: string | null;
}

function zeroVerdict(summary: string): AnomalyVerdict {
  return { score: 0, signals: [], actionable: false, summary };
}

/** Sightings arrive newest-first from the store; normalise and drop unusable rows. */
function normalise(sightings: SessionSighting[]): Timed[] {
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

/**
 * Largest number of distinct non-null values seen inside any single
 * CO_OCCURRENCE_WINDOW_MS-long slice of the history. Nulls are never counted:
 * a missing fingerprint is missing evidence, not a new device.
 */
function maxDistinctInWindow(
  rows: Timed[],
  pick: (row: Timed) => string | null
): number {
  let best = 0;
  for (let i = 0; i < rows.length; i++) {
    const seen = new Set<string>();
    for (let j = i; j < rows.length && rows[j].t - rows[i].t <= CO_OCCURRENCE_WINDOW_MS; j++) {
      const value = pick(rows[j]);
      if (value) seen.add(value);
    }
    if (seen.size > best) best = seen.size;
  }
  return best;
}

/** Most distinct non-null values seen on any single calendar day. */
function maxDistinctPerDay(
  rows: Timed[],
  pick: (row: Timed) => string | null
): number {
  const byDay = new Map<string, Set<string>>();
  for (const row of rows) {
    const value = pick(row);
    if (!value) continue;
    const key = new Date(row.t).toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.add(value);
    else byDay.set(key, new Set([value]));
  }
  let best = 0;
  for (const set of byDay.values()) if (set.size > best) best = set.size;
  return best;
}

/** Highest weight whose threshold the count reaches; 0 when it reaches none. */
function tier(count: number, table: Readonly<Record<number, number>>): number {
  let score = 0;
  for (const [threshold, weight] of Object.entries(table)) {
    if (count >= Number(threshold)) score = Math.max(score, weight);
  }
  return score;
}

function plural(count: number, singular: string, pluralWord: string): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function formatSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return plural(minutes, "minute", "minutes");
  return plural(Math.round(minutes / 60), "hour", "hours");
}

export function evaluateSessionAnomaly(
  sightings: SessionSighting[],
  opts?: { datacenterIp?: boolean; baseline?: SessionBaseline | null }
): AnomalyVerdict {
  const rows = normalise(sightings ?? []);

  // Not enough history to say anything. Note this short-circuits BEFORE the
  // datacenter flag is considered: "on a VPN" plus two heartbeats is not a
  // pattern either, and must never accumulate a score.
  if (rows.length < MIN_SIGHTINGS) {
    return zeroVerdict(
      `Only ${plural(rows.length, "heartbeat", "heartbeats")} on record — not enough history to judge.`
    );
  }

  const devices = maxDistinctInWindow(rows, (r) => r.fingerprint);
  const ips = maxDistinctInWindow(rows, (r) => r.ip);
  const countries = maxDistinctInWindow(rows, (r) => r.country);
  const datacenterIp = opts?.datacenterIp === true;

  /**
   * BASELINE-RELATIVE DEVICE SCORING.
   *
   * With a warm profile the question stops being "how many devices?" and
   * becomes "how many devices this account has never used, appearing WHILE the
   * familiar ones are still active?" — which is the shape of somebody else
   * logging in, and is not the shape of a browser update (old fingerprint out,
   * new one in) or of a member who simply owns three machines.
   *
   * Because unknown-and-concurrent is far stronger evidence than merely
   * distinct, it earns weight at a LOWER count: two strangers on a settled
   * one-laptop account says more than four devices on an account we know
   * nothing about. The two are scored separately and the HIGHER is taken, not
   * the sum — they are two readings of one thing, and adding them would double
   * count the same devices.
   *
   * Cold profile (under BASELINE_WARMUP_DAYS) → absolute thresholds only. A
   * baseline built from two days is just the last two days wearing a lab coat.
   */
  const baseline = opts?.baseline ?? null;
  const warm = baselineIsWarm(baseline);
  const known = new Set(baseline?.knownFingerprints ?? []);
  const unknownDevices = warm
    ? new Set(
        rows
          .map((r) => r.fingerprint)
          .filter((fp): fp is string => typeof fp === "string" && fp.length > 0)
          .filter((fp) => !known.has(fp))
      ).size
    : 0;

  /**
   * A WARM PROFILE SUPERSEDES THE ABSOLUTE TIER — it does not merely add to it.
   *
   * This is the half of the baseline that reduces false positives, and getting
   * it wrong makes the whole thing pointless: if the blanket "3 devices = 28"
   * rule still applied, the member who genuinely uses a laptop, a phone and a
   * tablet would keep scoring for it forever, no matter how settled their
   * profile got. The absolute tier is what you fall back on when you know
   * nothing about an account; once you know the account, you score the
   * DEPARTURE from what you know:
   *
   *   unknown  — devices this account has never used
   *   excess   — devices beyond its own established normal
   *
   * The higher of the two, never the sum: they are two readings of the same
   * devices and adding them would double count.
   */
  const excessDevices = Math.max(0, devices - (baseline?.typicalDevices ?? 0));
  const deviceScore = warm
    ? Math.max(
        tier(unknownDevices, WEIGHTS.unknownDevices),
        tier(excessDevices, WEIGHTS.excessDevices)
      )
    : tier(devices, WEIGHTS.devices);
  const ipScore = tier(ips, WEIGHTS.ips);
  // "impossible_travel" is a COARSE PROXY and nothing more: distinct country
  // codes inside a tight window. It is NOT travel-time math — we have no
  // coordinates, no distances and no speeds here, and country codes alone
  // cannot supply them. Two adjacent countries half an hour apart is an
  // ordinary drive; two country codes can also just mean a VPN was toggled or
  // a mobile carrier egressed abroad. Hence it is weighted as a supporting
  // signal, never a decisive one.
  //
  // And once the traffic is leaving a hosting range at all, the country stops
  // being evidence entirely: a rotating-exit VPN (Apple Private Relay,
  // Cloudflare WARP, Tor) picks a new country every few minutes BY DESIGN, so
  // "several countries" describes the product, not the member. Scoring it
  // anyway is exactly what let one honest person with a VPN and a
  // laptop/phone/tablet reach the revoke bar. Suppressed outright rather than
  // discounted — half credit for a signal we know is meaningless still points
  // at the wrong person. A genuine sharer behind a VPN still trips devices and
  // IPs, which are the signals that actually bear on the question.
  const travelScore = datacenterIp ? 0 : tier(countries, WEIGHTS.countries);
  const datacenterScore = datacenterIp ? WEIGHTS.datacenter : 0;

  /**
   * SESSION CHURN — the signal that exists because of one-seat enforcement.
   *
   * Refusing concurrent sign-ins does not stop sharing; it makes it SERIAL.
   * Two people take turns, each signing in once the other's seat goes idle.
   * Nothing co-occurs, so devices/IPs/countries all stay quiet — but the
   * account starts signing in six times a day when it used to sign in once.
   * Measured as a multiple of this account's own normal, which is the only way
   * the number means anything: "six sign-ins" is alarming for one member and a
   * Tuesday for another.
   */
  const sessionsToday = maxDistinctPerDay(rows, (r) => r.sessionId);
  const normalSessions = Math.max(1, baseline?.typicalSessionsPerDay ?? 0);
  const churnRatio = warm ? sessionsToday / normalSessions : 0;
  const churnScore = warm ? tier(churnRatio, WEIGHTS.sessionChurn) : 0;

  const signals: AnomalySignal[] = [];
  if (travelScore > 0) signals.push("impossible_travel");
  if (ipScore > 0) signals.push("many_ips");
  if (deviceScore > 0) signals.push("many_devices");
  if (churnScore > 0) signals.push("session_churn");
  if (datacenterScore > 0) signals.push("datacenter_ip");

  const score = Math.min(
    100,
    deviceScore + ipScore + travelScore + datacenterScore + churnScore
  );

  const spanMs = rows[rows.length - 1].t - rows[0].t;
  const where =
    spanMs <= CO_OCCURRENCE_WINDOW_MS
      ? formatSpan(spanMs)
      : `a ${Math.round(CO_OCCURRENCE_WINDOW_MS / 60_000)}-minute window`;
  const observed = [
    devices === 0
      ? "no device fingerprints"
      : plural(devices, "distinct device", "distinct devices"),
    ips === 0 ? "no usable IPs" : plural(ips, "IP address", "IP addresses"),
    plural(countries, "country", "countries"),
  ];
  const unfamiliar =
    warm && unknownDevices > 0
      ? `, ${plural(unknownDevices, "of them unfamiliar", "of them unfamiliar")}`
      : "";
  const churn =
    churnScore > 0
      ? `; ${plural(sessionsToday, "sign-in", "sign-ins")} today against a normal of ${normalSessions}`
      : "";
  const summary =
    `${observed[0]}${unfamiliar}, ${observed[1]} and ${observed[2]} within ${where}` +
    (datacenterIp ? ", from a hosting/VPN address" : "") +
    churn +
    (signals.length === 0
      ? warm
        ? " — nothing unusual for this account."
        : " — nothing unusual."
      : ".");

  return {
    score,
    signals,
    actionable: score >= ANOMALY_REVOKE_SCORE,
    summary,
  };
}
