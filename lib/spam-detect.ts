/**
 * SUITE 7 — SPOTTING SCAM POSTS IN THE SERVER.
 *
 * Compromised accounts wander into trading Discords and post phishing links —
 * fake Nitro, fake Steam gifts, IP loggers. This scores a message for how much
 * it looks like that.
 *
 * ── TWO THINGS THIS FILE IS BUILT AROUND ────────────────────────────────────
 *
 * 1. FALSE POSITIVES ARE THE CARDINAL SIN. Kicking a paying student because
 *    they linked a chart is far worse than missing a scam post that a human
 *    deletes a minute later. So a member who holds the access role can be
 *    REPORTED but never removed automatically, the administrator is exempt
 *    outright, and nothing scores at all without a link or a cross-post.
 *
 * 2. THIS IS A TRADING SERVER, and that rules out most of a normal scam word
 *    list. "crypto", "invest", "profit", "free", "signals", "USDT", "binance"
 *    are all ordinary conversation here — a generic filter would fire on them
 *    hourly. Everything below is chosen because it does NOT appear in genuine
 *    trading talk.
 */

export interface ScanMessage {
  id: string;
  channelId: string;
  content: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  mentionsEveryone: boolean;
}

export interface MemberFacts {
  /** From the account's snowflake — when the Discord account itself was made. */
  accountCreatedMs: number | null;
  /** When they joined THIS server. */
  joinedAtMs: number | null;
  roleCount: number;
  /** Paying student. Caps the action at "report" — never removal. */
  hasAccessRole: boolean;
  /** The owner. Exempt entirely; they post links for a living. */
  isAdmin: boolean;
}

export interface SpamVerdict {
  score: number;
  signals: string[];
  action: "ignore" | "report" | "remove";
}

export const REPORT_AT = 40;
export const REMOVE_AT = 70;

const DAY = 24 * 60 * 60 * 1000;
const DISCORD_EPOCH = 1420070400000;
/** A snowflake's timestamp lives in the high bits: id >> 22. */
const SNOWFLAKE_SHIFT = 4194304; // 2 ** 22

/**
 * Every Discord id encodes its own creation time, so account age costs no API
 * call.
 *
 * Done in plain Number arithmetic rather than BigInt: a 64-bit snowflake loses
 * its lowest ~10 bits when converted to a double, but those bits sit far below
 * the 22 this discards anyway — the resulting error is under a thousandth of a
 * millisecond, against a threshold measured in days.
 */
export function snowflakeToMs(id: string): number | null {
  if (!/^\d{15,25}$/.test(id)) return null;
  const ms = Math.floor(Number(id) / SNOWFLAKE_SHIFT) + DISCORD_EPOCH;
  return Number.isFinite(ms) ? ms : null;
}

const URL_RE = /https?:\/\/([^\s/$.?#][^\s/]*)([^\s]*)/gi;

export function extractHosts(content: string): string[] {
  const hosts: string[] = [];
  for (const m of (content ?? "").matchAll(URL_RE)) {
    const host = m[1]?.toLowerCase().replace(/^www\./, "");
    if (host) hosts.push(host);
  }
  return hosts;
}

/**
 * Brands that phishing impersonates, with their real domains.
 *
 * The rule this powers is the single most reliable signal here: a host that
 * CONTAINS one of these words but is not one of the real domains is a
 * lookalike, essentially always. Nobody legitimately links "discord-nitro.ru".
 */
const IMPERSONATED: Record<string, string[]> = {
  discord: ["discord.com", "discord.gg", "discordapp.com", "cdn.discordapp.com", "discord.media", "discordstatus.com"],
  steam: ["steamcommunity.com", "steampowered.com", "store.steampowered.com"],
  nitro: [],
};

/** Link shorteners and IP-logger services — both hide where a link really goes. */
const OPAQUE_HOSTS = [
  "bit.ly", "tinyurl.com", "cutt.ly", "is.gd", "rb.gy", "shorturl.at", "t.co",
  "rebrand.ly", "shorte.st", "adf.ly",
  // These exist only to harvest IPs from whoever clicks.
  "grabify.link", "iplogger.org", "iplogger.com", "blasze.com", "yip.su", "2no.co",
];

/** Free TLDs that legitimate businesses essentially never use. */
const RISKY_TLDS = [".tk", ".ml", ".ga", ".cf", ".gq", ".click", ".work", ".zip", ".mov", ".rest"];

/**
 * Phrases deliberately chosen to be absent from real trading conversation.
 *
 * NOT included, and this is the whole point: crypto, invest, profit, free,
 * signals, USDT, binance, funded, payout, withdrawal. Every one of those is
 * said sincerely in this server every day.
 */
const SCAM_PHRASES = [
  "free nitro", "discord nitro", "nitro giveaway", "steam gift", "gift card",
  "claim your", "claim it here", "who wants nitro", "first 10 people",
  "onlyfans", "nudes", "leaked", "18+", "hot girls", "teen",
  "i'm giving away", "im giving away", "dm me to claim",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CACHE = new Map<string, RegExp>();
function phrase(p: string): RegExp {
  let re = CACHE.get(p);
  if (!re) {
    re = new RegExp(`\\b${escape(p)}\\b`, "i");
    CACHE.set(p, re);
  }
  return re;
}

/** Edit distance, capped — we only ever care whether it is 1 or 2. */
function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** The registrable label — "dlscord" out of "dlscord.gift". */
function siteLabel(host: string): string {
  const parts = host.split(".").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? "");
}

/**
 * A host impersonating a brand it does not belong to.
 *
 * Two ways in, because phishing uses both. A host that CONTAINS the brand but
 * is not the real domain ("discord-nitro.ru", "steamcommunity.com.evil.ru") —
 * and a host one or two characters OFF it ("dlscord", "disc0rd", "steamcommunlty"),
 * which is the trick that beats a plain substring check and is the one people
 * actually click.
 */
export function isLookalikeHost(host: string): boolean {
  const h = host.toLowerCase();
  for (const [brand, legitimate] of Object.entries(IMPERSONATED)) {
    const isReal = legitimate.some((real) => h === real || h.endsWith(`.${real}`));
    if (isReal) continue;
    if (h.includes(brand)) return true;
  }

  // Near-misses, on the registrable label only. Short brands are excluded —
  // "nitro" is five characters, and at distance 2 that starts colliding with
  // ordinary words.
  const label = siteLabel(h);
  if (label.length >= 6) {
    for (const brand of ["discord", "discordapp", "steamcommunity", "steampowered"]) {
      const d = editDistance(label, brand);
      if (d > 0 && d <= 2) return true;
    }
  }
  return false;
}

/**
 * Collapses a message to what makes two posts "the same" for cross-post
 * detection: case, whitespace, punctuation and the URL path all removed, so a
 * bot rotating its tracking parameter still matches itself.
 */
export function normalizeForComparison(content: string): string {
  return (content ?? "")
    .toLowerCase()
    .replace(URL_RE, (_m, host: string) => ` ${String(host).toLowerCase()} `)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Scores one message.
 *
 * `crossPostChannels` is how many distinct channels this same author posted
 * this same text into during the sweep window — computed by the caller,
 * because it needs the whole batch to know.
 */
export function assessMessage(opts: {
  message: ScanMessage;
  member: MemberFacts;
  crossPostChannels: number;
  now?: number;
}): SpamVerdict {
  const { message, member } = opts;
  const now = opts.now ?? Date.now();
  const ignore = (reason: string): SpamVerdict => ({ score: 0, signals: [reason], action: "ignore" });

  // The owner posts links constantly and must never be actionable. Checked
  // first so no combination of signals can ever reach them.
  if (member.isAdmin) return ignore("administrator");

  const hosts = extractHosts(message.content);
  const crossPosted = opts.crossPostChannels >= 3;

  // NOTHING scores without a link or a cross-post. A member saying "free nitro
  // lol" in chat is making a joke; a filter that cannot tell the difference is
  // a filter that gets switched off within a week.
  if (hosts.length === 0 && !crossPosted) return ignore("no link and not cross-posted");

  let score = 0;
  const signals: string[] = [];
  const add = (points: number, why: string) => {
    score += points;
    signals.push(why);
  };

  // The strongest signal by a distance. A human does not paste identical text
  // into five channels inside a minute; automation does, and nothing else does.
  if (crossPosted) add(50, `posted in ${opts.crossPostChannels} channels`);

  if (hosts.some(isLookalikeHost)) add(30, "link impersonates Discord or Steam");
  if (hosts.some((h) => OPAQUE_HOSTS.includes(h))) add(20, "link shortener or IP logger");
  if (hosts.some((h) => RISKY_TLDS.some((tld) => h.endsWith(tld)))) add(12, "throwaway domain");

  if (message.mentionsEveryone && hosts.length > 0) add(25, "@everyone with a link");

  const scam = SCAM_PHRASES.find((p) => phrase(p).test(message.content));
  if (scam) add(20, `scam phrasing ("${scam}")`);

  if (member.accountCreatedMs !== null && now - member.accountCreatedMs < 30 * DAY) {
    add(15, "account less than 30 days old");
  }
  if (member.joinedAtMs !== null && now - member.joinedAtMs < 7 * DAY) {
    add(10, "joined within the last week");
  }
  if (member.roleCount === 0) add(5, "no roles");
  if (message.authorIsBot) add(10, "bot account");

  if (score < REPORT_AT) return { score, signals, action: "ignore" };

  // A paying student can be reported but never removed by a machine. If a
  // member's account really has been compromised, a human takes thirty seconds
  // to confirm it — and that is a far better trade than the alternative, which
  // is eventually kicking somebody who paid to be here.
  if (member.hasAccessRole) {
    return { score, signals: [...signals, "member holds the access role — report only"], action: "report" };
  }

  return { score, signals, action: score >= REMOVE_AT ? "remove" : "report" };
}
