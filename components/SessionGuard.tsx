"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getFingerprint } from "@/lib/device-fingerprint";
import { SESSION_HEARTBEAT_MS } from "@/lib/session-types";
import { createTabLock, type TabLockHandle } from "@/lib/tab-lock";

interface SessionGuardProps {
  isAdmin?: boolean;
}

const ENDPOINT = "/api/security/session/heartbeat";

/**
 * SUITE 7 — SESSION GUARD.
 *
 * Beats the heartbeat that holds this account's single seat, and shows the
 * final overlay when the server says the seat is no longer ours.
 *
 * ⚠ THE ONE RULE: only an explicit `current: false` FROM THE SERVER ends a
 * session here. A dropped fetch, a 500, a timeout, an offline laptop, a
 * captive-portal redirect — none of those are a revocation, and none of them
 * may put the overlay up. A false positive throws a paying member out of a
 * lesson for something their coffee-shop wifi did, and we have been burned by
 * exactly that before. When in doubt, do nothing and beat again in a minute.
 *
 * The opposite mistake is cheap: a session that really has been superseded but
 * whose "you're done" message arrives a minute late costs nobody anything,
 * because the server has already stopped honouring it.
 */
export default function SessionGuard({ isAdmin = false }: SessionGuardProps) {
  const [ended, setEnded] = useState(false);
  /**
   * ONE TAB TOO. The server cannot tell tabs apart — they all send the same
   * cookie — so a second tab is stopped here instead. `null` means the lock has
   * not been decided yet; nothing is rendered and no beat is sent until it is,
   * so a follower never fights the leader for the seat.
   */
  const [leads, setLeads] = useState<boolean | null>(null);
  const tabLock = useRef<TabLockHandle | null>(null);
  // Mirrors `ended` for the async beat, which closes over state that may be a
  // render behind — and for the interval, which must stop asking once the
  // answer is in.
  const endedRef = useRef(false);
  const inFlight = useRef(false);

  const leadsRef = useRef(false);

  const beat = useCallback(async () => {
    if (endedRef.current) return;
    // Only the tab holding the lock beats. If followers beat too they would
    // keep the seat warm from a window nobody is looking at, and the "one tab"
    // rule would be cosmetic.
    if (!leadsRef.current) return;
    // The visible/focus beats can pile onto the interval beat; one at a time
    // is plenty and keeps a slow network from queueing requests behind itself.
    if (inFlight.current) return;
    inFlight.current = true;

    let fingerprint = "";
    try {
      fingerprint = getFingerprint();
    } catch {
      // A device signature is a nicety. Beat without it.
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fingerprint ? { fingerprint } : {}),
        cache: "no-store",
      });
      // NOT a revocation: 401 (signed out — the next navigation handles it),
      // 429, 5xx, a Cloudflare error page. Only a 200 that says so counts.
      if (!res.ok) return;
      const data: unknown = await res.json().catch(() => null);
      if (data && typeof data === "object" && (data as { current?: unknown }).current === false) {
        endedRef.current = true;
        setEnded(true);
      }
    } catch {
      // Network failure. Say nothing, change nothing, try again next beat.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const lock = createTabLock({
      tabId: crypto.randomUUID(),
      onLeadershipChange: (isLeader) => {
        leadsRef.current = isLeader;
        setLeads(isLeader);
      },
    });
    tabLock.current = lock;
    // A tab going away hands the lock on immediately rather than making the
    // next tab wait out the ping timeout.
    const onUnload = () => lock.release();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      lock.release();
      tabLock.current = null;
    };
  }, []);

  useEffect(() => {
    // Once the overlay is up it stays up (see below), so there is nothing left
    // to ask the server and no reason to hold listeners open.
    if (ended) return;
    // Followers hold no seat and ask the server nothing.
    if (leads !== true) return;

    // Beat immediately: a member who has just landed on the dashboard should
    // hold their seat now, not in a minute.
    void beat();

    const timer = window.setInterval(() => void beat(), SESSION_HEARTBEAT_MS);

    // Background tabs get their timers throttled hard (Chrome drops a
    // background tab's interval to roughly once a minute, and an occluded or
    // frozen tab can stop firing altogether), so the interval alone is not a
    // reliable pulse. That is exactly why SESSION_IDLE_MS is three beats
    // rather than one — the seat survives a couple of missed beats — and why
    // we also beat the moment a tab comes back to the front, which both
    // re-establishes the pulse and gets the fastest possible answer to "am I
    // still the one holding this seat?".
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    const onFocus = () => void beat();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [beat, ended, leads]);

  if (leads === false) {
    return (
      <div className="session-ended-screen" role="alertdialog" aria-modal="true">
        <div className="session-ended-brand" aria-hidden>
          Suite 7&nbsp;&nbsp;Mentorship
        </div>
        <div className="session-ended-box">
          <p className="session-ended-label">Session limit reached</p>
          <h1>Suite 7 is already open in another window.</h1>
          <p>Please close the other tab or device first.</p>
          <div className="session-ended-actions">
            <button type="button" onClick={() => tabLock.current?.seize()}>
              Use this tab instead
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ended) return null;

  return (
    <div className="session-ended-screen" role="alertdialog" aria-modal="true">
      <div className="session-ended-brand" aria-hidden>
        Suite 7&nbsp;&nbsp;Mentorship
      </div>
      <div className="session-ended-box">
        <p className="session-ended-label">Session ended</p>
        <h1>This session is no longer active.</h1>
        {/* Admins can be signed out from elsewhere and can be ended by another
            administrator, so they beat like everyone else — but the one-seat
            language is a member rule and would only confuse them. */}
        {isAdmin ? (
          <p>This session was ended from another device, or by an administrator.</p>
        ) : (
          <>
            <p>
              This account signed in somewhere else, or an administrator ended
              this session.
            </p>
            <p>Sign in again to continue where you left off.</p>
          </>
        )}
        <div className="session-ended-actions">
          {/* The only way out. There is no dismiss and no close: the server has
              already stopped honouring this session, so leaving the page
              underneath reachable would only show stale material behind a
              login that no longer works. */}
          <button type="button" onClick={() => void signOut({ redirectTo: "/" })}>
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
