/**
 * SUITE 7 — ONE TAB PER BROWSER.
 *
 * The server enforces one SEAT per account, but it cannot see tabs: every tab
 * in a browser sends the same cookie, so to the server they are one session.
 * Blocking a second tab therefore has to happen in the browser, and this is it.
 *
 * ── WHY NOT JUST HEARTBEAT PER TAB ──────────────────────────────────────────
 * The obvious idea is to give each tab an id and let the server arbitrate. It
 * fails for the same reason the idle window had to be widened: Chrome throttles
 * and eventually freezes timers in hidden tabs, so the tab that legitimately
 * holds the lock stops beating the moment it is in the background — and gets
 * evicted by the tab in front of it. Tabs would take turns kicking each other
 * out all day.
 *
 * BroadcastChannel has neither problem. It is same-origin, in-process, delivers
 * synchronously between tabs, and is not subject to timer throttling — a
 * backgrounded leader still answers a claim instantly. No server, no network,
 * nothing to be throttled.
 *
 * ── THE PROTOCOL ────────────────────────────────────────────────────────────
 * A new tab announces `claim`. Any tab that already holds the lock answers
 * `held`. Hearing `held` makes the newcomer a follower; hearing nothing within
 * CLAIM_TIMEOUT_MS makes it the leader.
 *
 * Two tabs opened in the same instant both claim and both hear each other, so
 * the tie is broken deterministically on the id — every tab computes the same
 * winner without needing another round trip.
 *
 * A leader that goes away cleanly says `release`. A leader that vanishes
 * without saying anything (crash, kill, discard) is covered by `ping`: leaders
 * announce themselves periodically, and a follower that has heard nothing for
 * LEADER_TIMEOUT_MS takes over. So a crashed tab costs a few seconds, never a
 * permanently locked-out browser.
 *
 * FAILS OPEN. No BroadcastChannel (old browser, odd embedding) means every tab
 * believes it leads, which is exactly today's behaviour. This tightens the
 * common case; it must never be the reason somebody cannot use the site.
 */

export const TAB_CHANNEL = "suite7:tab-lock";

/** How long a new tab waits for an incumbent to answer before leading. */
export const CLAIM_TIMEOUT_MS = 350;

/** Leaders re-announce this often so followers know they are still there. */
export const PING_INTERVAL_MS = 2_000;

/** No ping for this long and a follower takes over. Three missed pings. */
export const LEADER_TIMEOUT_MS = 3 * PING_INTERVAL_MS;

export type TabMessage =
  | { type: "claim"; tabId: string }
  | { type: "held"; tabId: string }
  | { type: "ping"; tabId: string }
  | { type: "release"; tabId: string }
  /** A follower taking the lock on purpose — the "use this tab instead" button. */
  | { type: "seize"; tabId: string };

/**
 * Deterministic tie-break for two tabs that claimed simultaneously.
 *
 * Every tab runs this over the same pair and reaches the same answer, so no
 * further negotiation is needed. Lowest id wins — arbitrary, but it has to be
 * SOME total order and it has to be stable, and "lowest" is both.
 */
export function claimWinner(a: string, b: string): string {
  return a < b ? a : b;
}

export interface TabLockHandle {
  /** Stop participating and, if leading, hand the lock on. */
  release(): void;
  /** Take the lock from whoever holds it. Backs the "use this tab" escape. */
  seize(): void;
}

interface ChannelLike {
  postMessage(message: TabMessage): void;
  close(): void;
  onmessage: ((event: { data: TabMessage }) => void) | null;
}

export interface TabLockOptions {
  tabId: string;
  /** Called whenever leadership changes. `true` means this tab may run. */
  onLeadershipChange(isLeader: boolean): void;
  /** Injectable for tests; defaults to a real BroadcastChannel. */
  createChannel?: () => ChannelLike | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
}

function defaultChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(TAB_CHANNEL) as unknown as ChannelLike;
  } catch {
    // Constructing one can throw in a partitioned or otherwise restricted
    // context. Returning null takes the fail-open path; letting it throw would
    // propagate out of SessionGuard's effect and take the dashboard with it —
    // a tab-tidiness feature must never be able to break the site.
    return null;
  }
}

export function createTabLock(options: TabLockOptions): TabLockHandle {
  const {
    tabId,
    onLeadershipChange,
    createChannel = defaultChannel,
    now = () => Date.now(),
    setTimer = (fn, ms) => window.setTimeout(fn, ms) as unknown as number,
    clearTimer = (handle) => window.clearTimeout(handle),
  } = options;

  const channel = createChannel();
  if (!channel) {
    // No BroadcastChannel: lead unconditionally. See the fail-open note above.
    onLeadershipChange(true);
    return { release: () => {}, seize: () => {} };
  }

  let leader = false;
  let closed = false;
  /**
   * Set the moment any incumbent answers.
   *
   * NOT redundant with clearing `claimTimer`: BroadcastChannel can deliver the
   * reply before `claimTimer` has even been assigned — the incumbent answers
   * during our own `postMessage` call, which runs a line earlier — and a
   * handler that only clears the timer would then find nothing to clear and let
   * the claim succeed anyway. That is precisely how a second tab ends up
   * believing it leads. The flag does not depend on delivery timing.
   */
  let sawIncumbent = false;
  let lastLeaderSeen = now();
  let claimTimer: number | null = null;
  let watchTimer: number | null = null;

  const setLeader = (value: boolean) => {
    if (leader === value) return;
    leader = value;
    onLeadershipChange(value);
  };

  const send = (message: TabMessage) => {
    if (!closed) channel.postMessage(message);
  };

  /** Followers watch for a leader that has gone silent and take over. */
  const watch = () => {
    if (closed) return;
    watchTimer = setTimer(() => {
      if (!leader && now() - lastLeaderSeen >= LEADER_TIMEOUT_MS) {
        setLeader(true);
      }
      if (leader) send({ type: "ping", tabId });
      watch();
    }, PING_INTERVAL_MS);
  };

  channel.onmessage = (event) => {
    const message = event?.data;
    if (!message || typeof message !== "object" || message.tabId === tabId) return;

    switch (message.type) {
      case "claim":
        if (leader) {
          send({ type: "held", tabId });
          // A simultaneous claim means we both started at once; the loser of
          // the deterministic tie-break steps down without another round trip.
          if (claimWinner(tabId, message.tabId) !== tabId) setLeader(false);
        }
        break;
      case "held":
      case "ping":
        lastLeaderSeen = now();
        sawIncumbent = true;
        // Someone else holds it. If we also think we do, the tie-break decides
        // — otherwise a race could leave two tabs both believing they lead.
        if (leader && claimWinner(tabId, message.tabId) !== tabId) setLeader(false);
        else if (!leader && claimTimer !== null) {
          clearTimer(claimTimer);
          claimTimer = null;
        }
        break;
      case "seize":
        // Deliberate takeover from another tab; always yield to it.
        lastLeaderSeen = now();
        setLeader(false);
        break;
      case "release":
        // The holder is going away. Age it out rather than promoting straight
        // away, so several followers do not all grab the lock at once — the
        // watchdog's tie-break settles it.
        lastLeaderSeen = 0;
        sawIncumbent = false;
        break;
    }
  };

  send({ type: "claim", tabId });
  claimTimer = setTimer(() => {
    claimTimer = null;
    // Somebody answered while we were still setting this up. Stay a follower;
    // the watchdog below is what promotes us if that leader later goes quiet.
    if (sawIncumbent) return;
    // Nobody answered — this is the only tab.
    setLeader(true);
    send({ type: "ping", tabId });
  }, CLAIM_TIMEOUT_MS);
  watch();

  return {
    release() {
      closed = true;
      if (claimTimer !== null) clearTimer(claimTimer);
      if (watchTimer !== null) clearTimer(watchTimer);
      if (leader) channel.postMessage({ type: "release", tabId });
      channel.close();
    },
    seize() {
      lastLeaderSeen = now();
      send({ type: "seize", tabId });
      setLeader(true);
      send({ type: "ping", tabId });
    },
  };
}
