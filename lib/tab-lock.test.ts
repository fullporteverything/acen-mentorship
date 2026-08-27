import { describe, expect, it, vi } from "vitest";

import {
  CLAIM_TIMEOUT_MS,
  LEADER_TIMEOUT_MS,
  PING_INTERVAL_MS,
  claimWinner,
  createTabLock,
} from "./tab-lock";
import type { TabMessage } from "./tab-lock";

/**
 * A fake BroadcastChannel bus: every channel on it receives every message
 * except its own, which is exactly how the real one behaves.
 */
function createBus() {
  const channels: {
    id: number;
    open: boolean;
    onmessage: ((event: { data: TabMessage }) => void) | null;
  }[] = [];
  let nextId = 0;

  return {
    channels,
    open() {
      const channel = {
        id: nextId++,
        open: true,
        onmessage: null as ((event: { data: TabMessage }) => void) | null,
        postMessage(message: TabMessage) {
          // A closed channel sends nothing, like the real one. Without this a
          // "crashed" tab in the tests keeps pinging from beyond the grave and
          // no follower ever takes over.
          if (!channel.open) return;
          for (const other of channels) {
            if (other.id === channel.id || !other.open) continue;
            other.onmessage?.({ data: message });
          }
        },
        close() {
          channel.open = false;
        },
      };
      channels.push(channel);
      return channel;
    },
  };
}

/** Deterministic clock + timer queue, so nothing here depends on wall time. */
function createClock() {
  let time = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextHandle = 1;

  return {
    now: () => time,
    setTimer(fn: () => void, ms: number) {
      const handle = nextHandle++;
      timers.set(handle, { at: time + ms, fn });
      return handle;
    },
    clearTimer(handle: number) {
      timers.delete(handle);
    },
    advance(ms: number) {
      const target = time + ms;
      let guard = 0;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due || guard++ > 1000) break;
        const [handle, timer] = due;
        timers.delete(handle);
        time = timer.at;
        timer.fn();
      }
      time = target;
    },
  };
}

function mountTab(bus: ReturnType<typeof createBus>, clock: ReturnType<typeof createClock>, tabId: string) {
  const onLeadershipChange = vi.fn();
  const handle = createTabLock({
    tabId,
    onLeadershipChange,
    createChannel: () => bus.open(),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const isLeader = () => {
    const calls = onLeadershipChange.mock.calls;
    return calls.length ? Boolean(calls[calls.length - 1][0]) : false;
  };
  return { handle, onLeadershipChange, isLeader };
}

describe("tie-break", () => {
  it("is deterministic and symmetric, so both tabs agree without another round trip", () => {
    expect(claimWinner("a", "b")).toBe("a");
    expect(claimWinner("b", "a")).toBe("a");
    expect(claimWinner("a", "a")).toBe("a");
  });
});

describe("one tab leads", () => {
  it("a lone tab leads once nobody answers its claim", () => {
    const bus = createBus();
    const clock = createClock();
    const only = mountTab(bus, clock, "tab-1");

    expect(only.isLeader()).toBe(false);
    clock.advance(CLAIM_TIMEOUT_MS);

    expect(only.isLeader()).toBe(true);
  });

  it("a SECOND tab never leads while the first is there — the case this exists for", () => {
    const bus = createBus();
    const clock = createClock();
    const first = mountTab(bus, clock, "tab-1");
    clock.advance(CLAIM_TIMEOUT_MS);
    expect(first.isLeader()).toBe(true);

    const second = mountTab(bus, clock, "tab-2");
    clock.advance(CLAIM_TIMEOUT_MS * 3);

    expect(second.isLeader()).toBe(false);
    // And the incumbent is not disturbed by the newcomer.
    expect(first.isLeader()).toBe(true);
  });

  it("a backgrounded leader still answers, so a foreground tab cannot steal the lock", () => {
    // The whole reason this is BroadcastChannel and not a heartbeat: a hidden
    // tab's timers are throttled, but its message handler still runs.
    const bus = createBus();
    const clock = createClock();
    const background = mountTab(bus, clock, "tab-1");
    clock.advance(CLAIM_TIMEOUT_MS);

    const foreground = mountTab(bus, clock, "tab-2");
    clock.advance(CLAIM_TIMEOUT_MS * 2);

    expect(background.isLeader()).toBe(true);
    expect(foreground.isLeader()).toBe(false);
  });

  it("two tabs opened in the same instant settle on exactly one leader", () => {
    const bus = createBus();
    const clock = createClock();
    const a = mountTab(bus, clock, "tab-aaa");
    const b = mountTab(bus, clock, "tab-bbb");

    clock.advance(CLAIM_TIMEOUT_MS * 2);

    expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1);
    // The deterministic winner, so the outcome is reproducible.
    expect(a.isLeader()).toBe(true);
  });

  it("three tabs opened together still settle on exactly one", () => {
    const bus = createBus();
    const clock = createClock();
    const tabs = ["tab-c", "tab-a", "tab-b"].map((id) => mountTab(bus, clock, id));

    clock.advance(CLAIM_TIMEOUT_MS * 3);

    expect(tabs.filter((tab) => tab.isLeader())).toHaveLength(1);
  });
});

describe("handover", () => {
  it("closing the leader lets a waiting tab take over", () => {
    const bus = createBus();
    const clock = createClock();
    const first = mountTab(bus, clock, "tab-1");
    clock.advance(CLAIM_TIMEOUT_MS);
    const second = mountTab(bus, clock, "tab-2");
    clock.advance(CLAIM_TIMEOUT_MS);
    expect(second.isLeader()).toBe(false);

    first.handle.release();
    clock.advance(LEADER_TIMEOUT_MS + PING_INTERVAL_MS);

    expect(second.isLeader()).toBe(true);
  });

  it("a leader that vanishes without releasing is taken over after the ping timeout", () => {
    // Crashed, killed, or discarded by the browser: no release is ever sent.
    const bus = createBus();
    const clock = createClock();
    mountTab(bus, clock, "tab-1");
    clock.advance(CLAIM_TIMEOUT_MS);
    const second = mountTab(bus, clock, "tab-2");
    clock.advance(CLAIM_TIMEOUT_MS);

    // Silence the leader without a clean release.
    bus.channels[0].open = false;
    bus.channels[0].onmessage = null;
    clock.advance(LEADER_TIMEOUT_MS + PING_INTERVAL_MS);

    expect(second.isLeader()).toBe(true);
  });

  it("a live leader keeps its lock indefinitely — pings prevent a false takeover", () => {
    const bus = createBus();
    const clock = createClock();
    const first = mountTab(bus, clock, "tab-1");
    clock.advance(CLAIM_TIMEOUT_MS);
    const second = mountTab(bus, clock, "tab-2");

    clock.advance(LEADER_TIMEOUT_MS * 4);

    expect(first.isLeader()).toBe(true);
    expect(second.isLeader()).toBe(false);
  });

  it("seize moves the lock deliberately, and the old leader stands down", () => {
    // Backs the "use this tab instead" escape, so a follower is never stuck.
    const bus = createBus();
    const clock = createClock();
    const first = mountTab(bus, clock, "tab-1");
    clock.advance(CLAIM_TIMEOUT_MS);
    const second = mountTab(bus, clock, "tab-2");
    clock.advance(CLAIM_TIMEOUT_MS);

    second.handle.seize();
    clock.advance(PING_INTERVAL_MS);

    expect(second.isLeader()).toBe(true);
    expect(first.isLeader()).toBe(false);
  });
});

describe("fail-open", () => {
  it("leads immediately when BroadcastChannel is unavailable", () => {
    // Tightening the common case must never be the reason someone cannot use
    // the site at all.
    const clock = createClock();
    const onLeadershipChange = vi.fn();

    createTabLock({
      tabId: "tab-1",
      onLeadershipChange,
      createChannel: () => null,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    expect(onLeadershipChange).toHaveBeenCalledWith(true);
  });

  it("release is safe to call when there is no channel", () => {
    const clock = createClock();
    const handle = createTabLock({
      tabId: "tab-1",
      onLeadershipChange: vi.fn(),
      createChannel: () => null,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    expect(() => handle.release()).not.toThrow();
  });
});
