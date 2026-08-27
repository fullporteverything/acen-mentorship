import { describe, expect, it } from "vitest";

import { evaluateSessionAnomaly } from "./session-anomaly";
import { ANOMALY_REVOKE_SCORE, type SessionSighting } from "./session-types";

const T0 = Date.parse("2026-08-27T12:00:00.000Z");

function at(minutes: number): string {
  return new Date(T0 + minutes * 60_000).toISOString();
}

function sighting(
  minutes: number,
  ip: string | null,
  country: string | null,
  fingerprint: string | null
): SessionSighting {
  return { at: at(minutes), ip, country, fingerprint };
}

describe("session anomaly scoring — false positives (the ones that cost a member their access)", () => {
  it("does not flag one device hopping IPs for an hour (wifi ↔ cellular, CGNAT)", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "DE", "fp-phone"),
      sighting(12, "203.0.113.77", "DE", "fp-phone"),
      sighting(24, "198.51.100.4", "DE", "fp-phone"),
      sighting(36, "198.51.100.91", "DE", "fp-phone"),
      sighting(48, "203.0.113.10", "DE", "fp-phone"),
      sighting(60, "192.0.2.55", "DE", "fp-phone"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.actionable).toBe(false);
    expect(verdict.score).toBeLessThan(ANOMALY_REVOKE_SCORE);
    expect(verdict.signals).not.toContain("many_devices");
    expect(verdict.signals).not.toContain("impossible_travel");
  });

  it("does not flag one device in two countries an hour apart (VPN toggled off, or a border crossing)", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "NL", "fp-laptop"),
      sighting(60, "198.51.100.4", "DE", "fp-laptop"),
      sighting(61, "198.51.100.4", "DE", "fp-laptop"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.actionable).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.signals).toEqual([]);
  });

  it("does not flag a long, boring history from one IP and one device", () => {
    const sightings = Array.from({ length: 40 }, (_, i) =>
      sighting(i * 3, "203.0.113.10", "DE", "fp-laptop")
    );

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.actionable).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.signals).toEqual([]);
    expect(verdict.summary).toMatch(/nothing unusual/i);
  });

  it("does not score two sightings at all, however strange they look", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "BR", "fp-a"),
      sighting(1, "198.51.100.4", "JP", "fp-b"),
    ];

    const verdict = evaluateSessionAnomaly(sightings, { datacenterIp: true });

    expect(verdict).toEqual({
      score: 0,
      signals: [],
      actionable: false,
      summary: expect.stringMatching(/not enough history/i),
    });
  });

  it("does not flag a fingerprint that changes once and then stays stable (browser update)", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "DE", "fp-old"),
      sighting(5, "203.0.113.10", "DE", "fp-old"),
      sighting(10, "203.0.113.10", "DE", "fp-old"),
      sighting(15, "203.0.113.10", "DE", "fp-new"),
      sighting(20, "203.0.113.10", "DE", "fp-new"),
      sighting(25, "203.0.113.10", "DE", "fp-new"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.actionable).toBe(false);
    expect(verdict.signals).not.toContain("many_devices");
    expect(verdict.score).toBe(0);
  });

  it("does not flag a power user with three devices and a VPN in three countries", () => {
    // Phone (carrier egress abroad), laptop on a VPN, tablet at home. Three
    // plausible devices for ONE person; the countries are the VPN's doing.
    const sightings = [
      sighting(0, "203.0.113.10", "DE", "fp-laptop"),
      sighting(4, "198.51.100.4", "NL", "fp-phone"),
      sighting(9, "192.0.2.9", "US", "fp-tablet"),
      sighting(14, "203.0.113.10", "DE", "fp-laptop"),
    ];

    const verdict = evaluateSessionAnomaly(sightings, { datacenterIp: true });

    expect(verdict.actionable).toBe(false);
    expect(verdict.score).toBeLessThan(ANOMALY_REVOKE_SCORE);
  });
});

describe("session anomaly scoring — no single signal can revoke on its own", () => {
  it("keeps a device-only pattern below the bar", () => {
    const sightings = ["fp-1", "fp-2", "fp-3", "fp-4", "fp-5", "fp-6"].map((fp, i) =>
      sighting(i * 2, "203.0.113.10", "DE", fp)
    );

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.signals).toContain("many_devices");
    expect(verdict.actionable).toBe(false);
  });

  it("keeps an IP-only pattern below the bar", () => {
    const sightings = Array.from({ length: 8 }, (_, i) =>
      sighting(i * 2, `203.0.113.${i + 1}`, "DE", "fp-phone")
    );

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.signals).toContain("many_ips");
    expect(verdict.actionable).toBe(false);
  });

  it("keeps a country-only pattern below the bar", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "DE", "fp-laptop"),
      sighting(5, "203.0.113.10", "NL", "fp-laptop"),
      sighting(10, "203.0.113.10", "US", "fp-laptop"),
      sighting(15, "203.0.113.10", "DE", "fp-laptop"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.signals).toContain("impossible_travel");
    expect(verdict.actionable).toBe(false);
  });

  it("keeps a datacenter-only pattern below the bar", () => {
    const sightings = Array.from({ length: 5 }, (_, i) =>
      sighting(i * 5, "203.0.113.10", "DE", "fp-laptop")
    );

    const verdict = evaluateSessionAnomaly(sightings, { datacenterIp: true });

    expect(verdict.signals).toEqual(["datacenter_ip"]);
    expect(verdict.actionable).toBe(false);
    expect(verdict.score).toBeLessThan(ANOMALY_REVOKE_SCORE);
  });
});

describe("session anomaly scoring — the pattern worth catching", () => {
  it("flags several distinct devices across several countries inside a short window", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "DE", "fp-a"),
      sighting(3, "198.51.100.4", "BR", "fp-b"),
      sighting(7, "192.0.2.9", "US", "fp-c"),
      sighting(11, "203.0.113.99", "BR", "fp-d"),
      sighting(15, "198.51.100.4", "US", "fp-b"),
      sighting(20, "192.0.2.9", "DE", "fp-c"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.actionable).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(ANOMALY_REVOKE_SCORE);
    expect(verdict.signals).toEqual(
      expect.arrayContaining(["many_devices", "many_ips", "impossible_travel"])
    );
  });

  it("summarises what was observed in one plain sentence, without quoting a score", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "DE", "fp-a"),
      sighting(3, "198.51.100.4", "BR", "fp-b"),
      sighting(7, "192.0.2.9", "US", "fp-c"),
      sighting(11, "203.0.113.99", "BR", "fp-d"),
      sighting(15, "198.51.100.4", "US", "fp-b"),
      sighting(20, "192.0.2.9", "DE", "fp-c"),
    ];

    const { summary } = evaluateSessionAnomaly(sightings);

    expect(summary).toMatch(/4 distinct devices/);
    expect(summary).toMatch(/3 countries/);
    expect(summary).toMatch(/20 minutes/);
    expect(summary).not.toMatch(/score/i);
    expect(summary.trim().split(/[.!?]\s/).length).toBe(1);
  });

  it("caps the score at 100 and never exceeds it", () => {
    const sightings = [
      sighting(0, "203.0.113.1", "DE", "fp-a"),
      sighting(2, "203.0.113.2", "BR", "fp-b"),
      sighting(4, "203.0.113.3", "US", "fp-c"),
      sighting(6, "203.0.113.4", "JP", "fp-d"),
      sighting(8, "203.0.113.5", "AU", "fp-e"),
      sighting(10, "203.0.113.6", "ZA", "fp-f"),
    ];

    const verdict = evaluateSessionAnomaly(sightings, { datacenterIp: true });

    expect(verdict.score).toBeLessThanOrEqual(100);
    expect(verdict.actionable).toBe(true);
  });
});

describe("session anomaly scoring — degenerate input", () => {
  it("ignores unparseable timestamps rather than guessing", () => {
    const sightings: SessionSighting[] = [
      { at: "not-a-date", ip: "203.0.113.1", country: "DE", fingerprint: "fp-a" },
      { at: "also-not-a-date", ip: "203.0.113.2", country: "BR", fingerprint: "fp-b" },
      sighting(0, "203.0.113.3", "US", "fp-c"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.score).toBe(0);
    expect(verdict.summary).toMatch(/not enough history/i);
  });

  it("never treats a missing fingerprint as a new device", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "DE", null),
      sighting(2, "203.0.113.10", "DE", null),
      sighting(4, "203.0.113.10", "DE", null),
      sighting(6, "203.0.113.10", "DE", null),
      sighting(8, "203.0.113.10", "DE", null),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.signals).not.toContain("many_devices");
    expect(verdict.score).toBe(0);
  });

  it("reads newest-first history (the order the store returns) identically", () => {
    const ascending = [
      sighting(0, "203.0.113.10", "DE", "fp-a"),
      sighting(3, "198.51.100.4", "BR", "fp-b"),
      sighting(7, "192.0.2.9", "US", "fp-c"),
      sighting(11, "203.0.113.99", "BR", "fp-d"),
    ];

    expect(evaluateSessionAnomaly([...ascending].reverse())).toEqual(
      evaluateSessionAnomaly(ascending)
    );
  });

  it("returns a zero verdict for an empty history", () => {
    expect(evaluateSessionAnomaly([])).toMatchObject({
      score: 0,
      signals: [],
      actionable: false,
    });
  });
});

describe("session anomaly scoring — rotating-exit VPN on a genuine multi-device member", () => {
  /**
   * The case the scorer could not previously defend: one person, four of their
   * own devices, behind Apple Private Relay / Cloudflare WARP / Tor, whose exit
   * country changes every few minutes by design. Before country was suppressed
   * for hosting ranges this scored 40 + 30 + 10 = 80 and revoked an innocent
   * member.
   */
  it("does not flag four of one member's own devices behind a country-hopping VPN", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "NL", "fp-laptop"),
      sighting(3, "203.0.113.44", "DE", "fp-phone"),
      sighting(7, "198.51.100.4", "FR", "fp-tablet"),
      sighting(11, "198.51.100.91", "NL", "fp-work-laptop"),
      sighting(15, "192.0.2.55", "DE", "fp-laptop"),
    ];

    const verdict = evaluateSessionAnomaly(sightings, { datacenterIp: true });

    expect(verdict.actionable).toBe(false);
    expect(verdict.score).toBeLessThan(ANOMALY_REVOKE_SCORE);
    // The country signal must not merely be discounted — it must not fire at
    // all, because a VPN's exit country says nothing about where anyone is.
    expect(verdict.signals).not.toContain("impossible_travel");
  });

  it("still flags the same spread of devices when the traffic is NOT from a hosting range", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "NL", "fp-a"),
      sighting(3, "203.0.113.44", "DE", "fp-b"),
      sighting(7, "198.51.100.4", "FR", "fp-c"),
      sighting(11, "198.51.100.91", "BR", "fp-d"),
      sighting(15, "192.0.2.55", "JP", "fp-e"),
    ];

    const verdict = evaluateSessionAnomaly(sightings);

    expect(verdict.actionable).toBe(true);
    expect(verdict.signals).toContain("many_devices");
    expect(verdict.signals).toContain("impossible_travel");
  });

  it("still flags heavy device + IP spread behind a VPN, without leaning on country", () => {
    const sightings = [
      sighting(0, "203.0.113.10", "NL", "fp-a"),
      sighting(2, "203.0.113.44", "NL", "fp-b"),
      sighting(4, "198.51.100.4", "NL", "fp-c"),
      sighting(6, "198.51.100.91", "NL", "fp-d"),
      sighting(8, "192.0.2.55", "NL", "fp-e"),
      sighting(10, "192.0.2.99", "NL", "fp-f"),
    ];

    const verdict = evaluateSessionAnomaly(sightings, { datacenterIp: true });

    expect(verdict.actionable).toBe(true);
    expect(verdict.signals).toContain("many_devices");
    expect(verdict.signals).toContain("many_ips");
    expect(verdict.signals).not.toContain("impossible_travel");
  });
});
