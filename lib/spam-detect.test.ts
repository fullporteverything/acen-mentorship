import { describe, expect, it } from "vitest";

import {
  assessMessage,
  isLookalikeHost,
  normalizeForComparison,
  snowflakeToMs,
  type MemberFacts,
  type ScanMessage,
} from "./spam-detect";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 3);

const msg = (over: Partial<ScanMessage> = {}): ScanMessage => ({
  id: "1",
  channelId: "c1",
  content: "",
  authorId: "u1",
  authorName: "someone",
  authorIsBot: false,
  mentionsEveryone: false,
  ...over,
});

/** A brand-new account with no roles — the shape a scam post arrives in. */
const stranger = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  accountCreatedMs: NOW - 3 * DAY,
  joinedAtMs: NOW - 1 * DAY,
  roleCount: 0,
  hasAccessRole: false,
  isAdmin: false,
  ...over,
});

/** A paying member who has been here for months. */
const student = (over: Partial<MemberFacts> = {}): MemberFacts => ({
  accountCreatedMs: NOW - 900 * DAY,
  joinedAtMs: NOW - 200 * DAY,
  roleCount: 3,
  hasAccessRole: true,
  isAdmin: false,
  ...over,
});

const verdict = (m: Partial<ScanMessage>, member = stranger(), crossPostChannels = 1) =>
  assessMessage({ message: msg(m), member, crossPostChannels, now: NOW });

describe("catching the real thing", () => {
  it("removes a classic Nitro phish from a fresh account", () => {
    const v = verdict({
      content: "@everyone FREE NITRO for the first 10 people https://discord-nitro.tk/claim",
      mentionsEveryone: true,
    });
    expect(v.action).toBe("remove");
  });

  it("treats posting the same thing across channels as the strongest signal", () => {
    // No human pastes identical text into five channels in a minute.
    const v = verdict({ content: "check this out https://cutt.ly/abc" }, stranger(), 5);
    expect(v.action).toBe("remove");
    expect(v.signals.join(" ")).toContain("5 channels");
  });

  it("spots a domain impersonating Discord or Steam", () => {
    expect(isLookalikeHost("discord-nitro.ru")).toBe(true);
    expect(isLookalikeHost("steamcommunity.com.evil.ru")).toBe(true);
    // Misspellings are the version people actually click, and they beat a
    // plain substring check.
    expect(isLookalikeHost("dlscord.gift")).toBe(true);
    expect(isLookalikeHost("disc0rd.com")).toBe(true);
    expect(isLookalikeHost("steamcommunlty.link")).toBe(true);
    // The real ones must never trip it.
    expect(isLookalikeHost("discord.com")).toBe(false);
    expect(isLookalikeHost("discord.gg")).toBe(false);
    expect(isLookalikeHost("cdn.discordapp.com")).toBe(false);
    expect(isLookalikeHost("steamcommunity.com")).toBe(false);
    // And ordinary domains must survive the fuzzy check.
    for (const safe of [
      "tradingview.com", "youtube.com", "google.com", "records.com",
      "discourse.org", "notion.so", "x.com", "ninjatrader.com",
    ]) {
      expect(isLookalikeHost(safe)).toBe(false);
    }
  });

  it("flags an IP logger", () => {
    const v = verdict({ content: "look at my chart https://grabify.link/xyz" });
    expect(v.action).not.toBe("ignore");
  });
});

describe("the false positives — the cardinal sin", () => {
  it("never touches the administrator", () => {
    const v = verdict(
      { content: "@everyone free nitro https://discord-nitro.tk", mentionsEveryone: true },
      stranger({ isAdmin: true })
    );
    expect(v.action).toBe("ignore");
  });

  it("never REMOVES a member holding the access role, only reports", () => {
    // A hijacked student account is real, but so is the alternative: a machine
    // kicking somebody who paid to be here. A human confirms in 30 seconds.
    const v = verdict(
      { content: "@everyone free nitro https://discord-nitro.tk/claim", mentionsEveryone: true },
      student()
    );
    expect(v.action).toBe("report");
    expect(v.signals.join(" ")).toContain("access role");
  });

  it("ignores ordinary trading talk, which is where a generic filter dies", () => {
    // Every one of these contains a word a stock scam-list would fire on.
    for (const content of [
      "just took profit on NQ, free flowing today",
      "anyone else invested in crypto this week",
      "my binance USDT balance is finally green",
      "free signals are always a scam btw",
      "got funded, payout requested",
    ]) {
      expect(verdict({ content }).action).toBe("ignore");
    }
  });

  it("ignores a normal link from a normal member", () => {
    expect(verdict({ content: "here's the chart https://tradingview.com/x/abc" }, student()).action)
      .toBe("ignore");
    expect(verdict({ content: "https://youtube.com/watch?v=abc" }, student()).action).toBe("ignore");
  });

  it("does not act on scam WORDS alone with no link", () => {
    // "free nitro lol" in chat is a joke. A filter that cannot tell gets
    // switched off inside a week.
    expect(verdict({ content: "imagine falling for free nitro lol" }).action).toBe("ignore");
  });

  it("does not punish a new member for merely being new", () => {
    expect(verdict({ content: "hey everyone, glad to be here" }).action).toBe("ignore");
    expect(verdict({ content: "found you through https://youtube.com/@acen" }).action).toBe("ignore");
  });
});

describe("supporting maths", () => {
  it("reads an account's age out of its own id", () => {
    // 2026-08-30-ish snowflake from the payouts channel.
    const ms = snowflakeToMs("1543239856174669824");
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getUTCFullYear()).toBe(2026);
    expect(snowflakeToMs("nonsense")).toBeNull();
    expect(snowflakeToMs("")).toBeNull();
  });

  it("matches a bot rotating its tracking parameter against itself", () => {
    const a = normalizeForComparison("Free stuff!! https://evil.tk/a?ref=1");
    const b = normalizeForComparison("free stuff https://evil.tk/b?ref=99");
    expect(a).toBe(b);
  });
});
