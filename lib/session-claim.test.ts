import { describe, expect, it } from "vitest";

import { decideClaim, isStale, type ExistingClaim } from "@/lib/session-claim";
import { SESSION_IDLE_MS } from "@/lib/session-types";

const NOW = 1_700_000_000_000;
const IDLE = SESSION_IDLE_MS;

function existing(overrides: Partial<ExistingClaim> = {}): ExistingClaim {
  return {
    sessionId: "incumbent-session",
    lastSeenAt: NOW,
    revokedAt: null,
    ...overrides,
  };
}

describe("decideClaim", () => {
  it("grants the seat when nobody holds it", () => {
    expect(
      decideClaim({
        now: NOW,
        incomingSessionId: "newcomer",
        existing: null,
        idleMs: IDLE,
      })
    ).toEqual({ grant: true });
  });

  it("grants the seat when the holder stopped beating for the whole idle window", () => {
    // The closed-laptop case: nobody should have to call an admin to get
    // back in from a second device.
    expect(
      decideClaim({
        now: NOW,
        incomingSessionId: "newcomer",
        existing: existing({ lastSeenAt: NOW - IDLE - 1 }),
        idleMs: IDLE,
      })
    ).toEqual({ grant: true });
  });

  it("REFUSES a second sign-in while the holder is still beating", () => {
    // The whole point of the feature: a shared or stolen login must not be
    // able to evict the real member just by logging in.
    const lastSeenAt = NOW - 5_000;
    expect(
      decideClaim({
        now: NOW,
        incomingSessionId: "newcomer",
        existing: existing({ lastSeenAt }),
        idleMs: IDLE,
      })
    ).toEqual({ grant: false, activeSince: lastSeenAt });
  });

  it("grants a live session its own seat again (refresh, not a second seat)", () => {
    expect(
      decideClaim({
        now: NOW,
        incomingSessionId: "incumbent-session",
        existing: existing({ sessionId: "incumbent-session", lastSeenAt: NOW - 1_000 }),
        idleMs: IDLE,
      })
    ).toEqual({ grant: true });
  });

  it("grants the seat when the holder was explicitly revoked", () => {
    // Signed out, admin-kicked or anomaly-revoked: the seat is free even
    // though the heartbeat is a millisecond old.
    expect(
      decideClaim({
        now: NOW,
        incomingSessionId: "newcomer",
        existing: existing({ lastSeenAt: NOW, revokedAt: NOW - 1 }),
        idleMs: IDLE,
      })
    ).toEqual({ grant: true });
  });

  it("grants a revoked session's own id back (a fresh claim after sign-out)", () => {
    expect(
      decideClaim({
        now: NOW,
        incomingSessionId: "incumbent-session",
        existing: existing({ revokedAt: NOW - 10 }),
        idleMs: IDLE,
      })
    ).toEqual({ grant: true });
  });

  describe("the idle boundary", () => {
    it("treats a heartbeat of exactly idleMs ago as dead", () => {
      expect(
        decideClaim({
          now: NOW,
          incomingSessionId: "newcomer",
          existing: existing({ lastSeenAt: NOW - IDLE }),
          idleMs: IDLE,
        })
      ).toEqual({ grant: true });
    });

    it("treats a heartbeat one millisecond inside the window as live", () => {
      const lastSeenAt = NOW - IDLE + 1;
      expect(
        decideClaim({
          now: NOW,
          incomingSessionId: "newcomer",
          existing: existing({ lastSeenAt }),
          idleMs: IDLE,
        })
      ).toEqual({ grant: false, activeSince: lastSeenAt });
    });

    it("treats a heartbeat from the future as live, not as skew to exploit", () => {
      // Clock skew between serverless instances must never hand a second
      // party the seat.
      const lastSeenAt = NOW + 30_000;
      expect(
        decideClaim({
          now: NOW,
          incomingSessionId: "newcomer",
          existing: existing({ lastSeenAt }),
          idleMs: IDLE,
        })
      ).toEqual({ grant: false, activeSince: lastSeenAt });
    });

    it("refuses on a zero-age heartbeat and frees a wildly stale one", () => {
      expect(
        decideClaim({
          now: NOW,
          incomingSessionId: "newcomer",
          existing: existing({ lastSeenAt: NOW }),
          idleMs: IDLE,
        })
      ).toMatchObject({ grant: false });
      expect(
        decideClaim({
          now: NOW,
          incomingSessionId: "newcomer",
          existing: existing({ lastSeenAt: NOW - 30 * 24 * 60 * 60 * 1000 }),
          idleMs: IDLE,
        })
      ).toEqual({ grant: true });
    });

    it("honours a caller-supplied idle window rather than the constant", () => {
      const existingRow = existing({ lastSeenAt: NOW - 10_000 });
      expect(
        decideClaim({ now: NOW, incomingSessionId: "newcomer", existing: existingRow, idleMs: 5_000 })
      ).toEqual({ grant: true });
      expect(
        decideClaim({ now: NOW, incomingSessionId: "newcomer", existing: existingRow, idleMs: 20_000 })
      ).toMatchObject({ grant: false });
    });
  });
});

describe("isStale", () => {
  it("is exclusive below the window and inclusive at it", () => {
    expect(isStale(NOW, NOW - IDLE + 1, IDLE)).toBe(false);
    expect(isStale(NOW, NOW - IDLE, IDLE)).toBe(true);
    expect(isStale(NOW, NOW - IDLE - 1, IDLE)).toBe(true);
    expect(isStale(NOW, NOW + 1, IDLE)).toBe(false);
  });
});
