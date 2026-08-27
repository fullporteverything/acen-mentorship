import { describe, expect, it } from "vitest";
import { computeFingerprint, type FingerprintParts } from "./device-fingerprint";

/** A plausible desktop browser, used as the baseline to vary one field at a time. */
const DESKTOP: FingerprintParts = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  screenWidth: 1920,
  screenHeight: 1080,
  colorDepth: 24,
  timezone: "Europe/London",
  language: "en-GB",
  hardwareConcurrency: 8,
  devicePixelRatio: 2,
};

describe("computeFingerprint", () => {
  it("is stable: the same parts always produce the same hash", () => {
    const first = computeFingerprint(DESKTOP);
    const second = computeFingerprint({ ...DESKTOP });
    expect(second).toBe(first);
    // And still stable across many calls — nothing accumulates between runs.
    expect(computeFingerprint(DESKTOP)).toBe(first);
  });

  it("returns a short lowercase hex string", () => {
    expect(computeFingerprint(DESKTOP)).toMatch(/^[0-9a-f]{16}$/);
    expect(computeFingerprint({})).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when any single part changes", () => {
    const baseline = computeFingerprint(DESKTOP);
    const variants: FingerprintParts[] = [
      { ...DESKTOP, userAgent: `${DESKTOP.userAgent} Edg/131.0.0.0` },
      { ...DESKTOP, screenWidth: 1512 },
      { ...DESKTOP, screenHeight: 982 },
      { ...DESKTOP, colorDepth: 30 },
      { ...DESKTOP, timezone: "America/New_York" },
      { ...DESKTOP, language: "en-US" },
      { ...DESKTOP, hardwareConcurrency: 12 },
      { ...DESKTOP, devicePixelRatio: 1 },
    ];
    for (const variant of variants) {
      expect(computeFingerprint(variant)).not.toBe(baseline);
    }
    // All eight variants are distinct from each other too, not merely from
    // the baseline — a hash that folded two fields together would pass the
    // check above and still be useless to the anomaly scorer.
    expect(new Set(variants.map(computeFingerprint)).size).toBe(variants.length);
  });

  it("does not confuse fields whose values are swapped between them", () => {
    // Naive concatenation would hash 1920+1080 and 1080+1920 identically.
    expect(
      computeFingerprint({ ...DESKTOP, screenWidth: 1080, screenHeight: 1920 })
    ).not.toBe(computeFingerprint(DESKTOP));
  });

  it("tolerates missing, null and undefined fields", () => {
    expect(() => computeFingerprint({})).not.toThrow();
    expect(() =>
      computeFingerprint({
        userAgent: null,
        screenWidth: null,
        screenHeight: null,
        colorDepth: null,
        timezone: null,
        language: null,
        hardwareConcurrency: null,
        devicePixelRatio: null,
      })
    ).not.toThrow();

    // A withheld field is treated as its own stable value, so a hardened
    // browser gets one consistent signature rather than a new one per beat.
    const withheld = computeFingerprint({ ...DESKTOP, hardwareConcurrency: undefined });
    expect(computeFingerprint({ ...DESKTOP, hardwareConcurrency: null })).toBe(withheld);
    expect(withheld).not.toBe(computeFingerprint(DESKTOP));

    // An empty or whitespace-only string is "absent" too — Safari reports
    // an empty timezone in some lockdown configurations.
    expect(computeFingerprint({ ...DESKTOP, timezone: "" })).toBe(
      computeFingerprint({ ...DESKTOP, timezone: undefined })
    );
    expect(computeFingerprint({ ...DESKTOP, timezone: "   " })).toBe(
      computeFingerprint({ ...DESKTOP, timezone: undefined })
    );
  });

  it("ignores non-finite numbers rather than producing NaN", () => {
    const absent = computeFingerprint({ ...DESKTOP, devicePixelRatio: undefined });
    expect(computeFingerprint({ ...DESKTOP, devicePixelRatio: Number.NaN })).toBe(absent);
    expect(
      computeFingerprint({ ...DESKTOP, devicePixelRatio: Number.POSITIVE_INFINITY })
    ).toBe(absent);
  });

  it("rounds devicePixelRatio so a zoom nudge is not a new device", () => {
    const base = computeFingerprint({ ...DESKTOP, devicePixelRatio: 1.5 });
    expect(computeFingerprint({ ...DESKTOP, devicePixelRatio: 1.501 })).toBe(base);
    expect(computeFingerprint({ ...DESKTOP, devicePixelRatio: 1.75 })).not.toBe(base);
  });

  it("keeps distinct hashes across a realistic spread of devices", () => {
    const devices: FingerprintParts[] = [
      DESKTOP,
      {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
        screenWidth: 393,
        screenHeight: 852,
        colorDepth: 32,
        timezone: "Europe/London",
        language: "en-GB",
        hardwareConcurrency: 6,
        devicePixelRatio: 3,
      },
      {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        screenWidth: 2560,
        screenHeight: 1440,
        colorDepth: 24,
        timezone: "America/Chicago",
        language: "en-US",
        hardwareConcurrency: 16,
        devicePixelRatio: 1,
      },
      {
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
        screenWidth: 1920,
        screenHeight: 1080,
        colorDepth: 24,
        timezone: "Europe/Berlin",
        language: "de-DE",
        hardwareConcurrency: 8,
        devicePixelRatio: 1,
      },
      {},
    ];
    expect(new Set(devices.map(computeFingerprint)).size).toBe(devices.length);
  });
});
