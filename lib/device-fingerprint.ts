/**
 * SUITE 7 — DEVICE SIGNATURE.
 *
 * A stable, low-entropy signature of the browser, sent with the session
 * heartbeat and stored on the sighting so lib/session-anomaly.ts can ask
 * "has this account been beating from three different machines in the last
 * hour?".
 *
 * ⚠ IT IS A SIGNAL, NEVER AN IDENTITY AND NEVER A SECURITY CONTROL. Every
 * input here is attacker-controlled: the whole thing is computed in the page
 * and POSTed, so anyone willing to open devtools can send whatever string
 * they like, and two colleagues on identical corporate laptops legitimately
 * produce the SAME value. Nothing may be granted, denied or revoked on this
 * alone — it only ever nudges a score that also weighs IP and timing.
 *
 * NO CANVAS, NO WEBGL. The high-entropy tricks (rendering text to a canvas
 * and hashing the pixels, hashing the WebGL vendor/renderer strings) are
 * deliberately not used:
 *   • They are invasive. They exist to identify a person across sites they
 *     never agreed to be linked across, and browsers treat them as tracking —
 *     Safari lies about them, Firefox's resistFingerprinting blocks them, and
 *     privacy extensions randomise them per call.
 *   • They are fragile. A GPU driver update, an OS point release or a switch
 *     between integrated and discrete graphics silently changes the hash,
 *     which reads to the scorer as "new device" for a member who changed
 *     nothing. False positives here cost somebody their access.
 *   • They are not worth the fight. This is one of the scorer's weakest
 *     inputs; a little more entropy does not justify shipping a tracking
 *     technique into a members' area.
 * The stable, boring set below separates one machine from another often
 * enough to be a useful signal, and it is all data the site already receives
 * or could trivially read.
 */

/**
 * The inputs, passed in rather than read from globals so the hash is a pure
 * function and can be tested without a DOM. Every field is optional: a
 * hardened or headless browser can withhold any of them, and a missing field
 * must degrade the signature, not throw.
 */
export interface FingerprintParts {
  userAgent?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  colorDepth?: number | null;
  timezone?: string | null;
  language?: string | null;
  hardwareConcurrency?: number | null;
  devicePixelRatio?: number | null;
}

/** localStorage key. Same `dojo:` prefix as the other client-side caches. */
const CACHE_KEY = "dojo:deviceFp";

/** Anything absent becomes this, so "missing" is itself a stable input. */
const ABSENT = "-";

/** Field separator (US, unit separator) — cannot occur in any input. */
const SEP = "\u001f";

function normalise(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ABSENT;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ABSENT;
    // Two decimals: devicePixelRatio is fractional on HiDPI displays, and
    // browser zoom perturbs it slightly. Rounding keeps a zoom nudge from
    // reading as a different machine (and the localStorage cache below is
    // the real defence against that).
    return String(Math.round(value * 100) / 100);
  }
  const trimmed = value.trim();
  return trimmed === "" ? ABSENT : trimmed;
}

/**
 * djb2 (Bernstein), xor variant. Plain JS, no dependency, `>>> 0` after every
 * step to stay in unsigned 32-bit territory rather than drifting into float
 * precision.
 */
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (((hash << 5) + hash) ^ input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

/** sdbm, run alongside djb2 purely to widen 32 bits of output to 64. */
function sdbm(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (input.charCodeAt(i) + (hash << 6) + (hash << 16) - hash) >>> 0;
  }
  return hash >>> 0;
}

function hex32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * Pure: same parts in, same 16-character lowercase hex out. Two different
 * hash functions are concatenated rather than one taken twice, because a
 * single 32-bit space collides often enough to matter across a membership.
 */
export function computeFingerprint(parts: FingerprintParts): string {
  const canonical = [
    normalise(parts.userAgent),
    normalise(parts.screenWidth),
    normalise(parts.screenHeight),
    normalise(parts.colorDepth),
    normalise(parts.timezone),
    normalise(parts.language),
    normalise(parts.hardwareConcurrency),
    normalise(parts.devicePixelRatio),
  ].join(SEP);
  return `${hex32(djb2(canonical))}${hex32(sdbm(canonical))}`;
}

/** Reads what this browser will admit to. Never throws. */
function readParts(): FingerprintParts {
  let timezone: string | null = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // Intl is present everywhere we support, but a locked-down build can
    // still refuse the timezone. Missing is a valid input.
  }
  return {
    userAgent: navigator.userAgent,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
    colorDepth: window.screen?.colorDepth,
    timezone,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
  };
}

/**
 * Browser wrapper: the cached signature for this browser, computing and
 * caching it on first call. Returns "" when there is no DOM (SSR) or when
 * reading the environment fails — callers must treat "" as "no signal" and
 * carry on, never as an error.
 *
 * The cache is what makes this STABLE rather than merely deterministic: it
 * pins the value taken on the first visit, so a later zoom change, an
 * external monitor or a browser update that rewrites the user-agent string
 * does not turn a returning member into a brand-new device.
 */
export function getFingerprint(): string {
  if (typeof window === "undefined") return "";

  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached && /^[0-9a-f]{16}$/.test(cached)) return cached;
  } catch {
    // Private mode / storage disabled — fall through and compute fresh.
  }

  let value: string;
  try {
    value = computeFingerprint(readParts());
  } catch {
    return "";
  }

  try {
    localStorage.setItem(CACHE_KEY, value);
  } catch {
    // Uncached is fine; it just recomputes next time.
  }
  return value;
}
