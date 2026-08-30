/**
 * SUITE 7 — READING PAYOUT AMOUNTS OUT OF DISCORD MESSAGES.
 *
 * Members post their payouts in a channel, freehand. This turns those messages
 * into candidate amounts for the counter.
 *
 * ── WHY THIS IS DELIBERATELY CONSERVATIVE ───────────────────────────────────
 * The total this feeds is a PUBLIC CLAIM ABOUT STUDENT RESULTS. It goes on a
 * Discord channel name and, eventually, a sales page. So the failure that
 * matters is not "we missed a payout" — a member can always be added by hand.
 * It is "we counted something that was not a payout", because that inflates a
 * number the owner may one day have to defend, and he will not be able to
 * reconstruct why it was wrong.
 *
 * A naive /\$[\d,]+/ over a real payouts channel picks up all of this:
 *
 *   "I lost $300 today"              a loss
 *   "goal is $10k by december"       an aspiration
 *   "is $2500 a good first payout?"  a question
 *   "he made $5k last week"          somebody else's money
 *   "$150 eval fee"                  a cost, not a payout
 *   "congrats on the $2k bro"        a reply quoting someone else's number
 *
 * Every one of those inflates the total. So this reads the words AROUND the
 * number, not just the number, and refuses anything it cannot place. Refusals
 * are cheap: they land in the admin review queue, where a human decides in one
 * click. Nothing here writes to the counter on its own.
 */

export interface PayoutCandidate {
  /** Amount in whole cents, so nothing is ever stored as a float. */
  amountCents: number;
  /** What in the text produced the amount — shown in the review queue. */
  matched: string;
  /** Why it was accepted, for the audit trail. */
  reason: string;
}

export type ParseResult =
  | { ok: true; candidate: PayoutCandidate }
  /** Nothing to count. `needsReview` means a human should still look. */
  | { ok: false; reason: string; needsReview: boolean };

/**
 * Words that make a nearby number NOT a payout. Ordered roughly by how often
 * they show up in a real trading Discord.
 */
const DISQUALIFIERS = [
  // Losses and drawdown
  "lost", "loss", "losing", "down", "red", "blew", "blown", "drawdown", "dd",
  "negative", "gave back",
  // Aspiration rather than fact
  "goal", "target", "aiming", "hoping", "want to", "wanna", "trying to",
  "by december", "by the end", "next month", "one day", "someday", "soon",
  // Costs
  "fee", "cost", "paid for", "bought", "subscription", "eval fee", "reset",
  // Somebody else's money
  "he made", "she made", "they made", "his", "her", "their",
  "congrats", "congratulations", "gz", "grats", "proud of",
  // Hypotheticals and questions
  "if i", "would be", "could be", "imagine", "what if", "should i",
];

/** Words that positively mark a number as a real, received payout. */
const CONFIRMERS = [
  "payout", "paid out", "withdrew", "withdrawal", "withdraw", "cashed out",
  "cash out", "got paid", "hit my", "received", "cleared", "landed",
  "first payout", "another payout", "requested",
];

/** Sanity bounds. Outside these a human looks, always. */
const MIN_CENTS = 5_00;
const MAX_CENTS = 500_000_00;

/**
 * Matches money in the shapes people actually type:
 *   $2,500   $2500   2500$   $1.2k   1.2k   $2.5K   $500.50
 * Requires either a currency symbol or a k/K suffix, so a bare "5" in "5 min"
 * or a date like "2025" is never read as an amount.
 */
const MONEY = /(?:\$\s?([\d,]+(?:\.\d{1,2})?)\s?([kK])?)|(?:\b([\d,]+(?:\.\d{1,2})?)\s?([kK])\b)/g;

function toCents(raw: string, suffix: string | undefined): number | null {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const scaled = suffix ? n * 1000 : n;
  // Guard against absurd values before they can overflow anything downstream.
  if (scaled > 100_000_000) return null;
  return Math.round(scaled * 100);
}

/** Lowercased text within `window` characters either side of a match. */
function contextAround(text: string, index: number, length: number, window = 45): string {
  return text
    .slice(Math.max(0, index - window), index + length + window)
    .toLowerCase();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whole-word phrase matching.
 *
 * NOT `includes`. Substring matching silently destroys this: "red" is inside
 * "cleared", so "payout of $2500 cleared" — an unambiguously real payout —
 * was being thrown out as a loss. The same trap waits in "down"/"downside",
 * "dd"/"added", "her"/"there". Word boundaries or nothing.
 */
const WORD_CACHE = new Map<string, RegExp>();
function phraseRegex(phrase: string): RegExp {
  let re = WORD_CACHE.get(phrase);
  if (!re) {
    re = new RegExp(`\\b${escape(phrase)}\\b`, "i");
    WORD_CACHE.set(phrase, re);
  }
  return re;
}

function hit(context: string, phrases: readonly string[]): string | null {
  for (const phrase of phrases) if (phraseRegex(phrase).test(context)) return phrase;
  return null;
}

/**
 * Is the member ASKING about a number rather than reporting one?
 *
 * "is $2500 a good first payout?" contains the phrase "first payout" and would
 * otherwise sail through as confirmed. A question mark is the cheapest reliable
 * signal that a number is being discussed rather than banked. Genuine payout
 * posts rarely carry one; when they do ("$2,500 payout!! anyone else?") the
 * cost is a review click, which is the direction we want to be wrong in.
 */
function looksLikeAQuestion(text: string): boolean {
  if (text.includes("?")) return true;
  return /^\s*(is|are|was|were|do|does|did|can|could|should|would|what|how|why|when|who|anyone|anybody)\b/i
    .test(text);
}

/**
 * Reads one message. Returns at most ONE candidate — the largest qualifying
 * amount — because a message quoting several numbers ("took $500 and $300
 * today, $800 total") would otherwise be double counted. The largest is
 * usually the total; a human corrects the rare case in review.
 */
export function parsePayoutMessage(
  content: string,
  options: { hasAttachment?: boolean } = {}
): ParseResult {
  const text = (content ?? "").trim();

  if (!text) {
    return options.hasAttachment
      ? { ok: false, reason: "image only, no text to read", needsReview: true }
      : { ok: false, reason: "empty message", needsReview: false };
  }

  const matches = [...text.matchAll(MONEY)];
  if (matches.length === 0) {
    return options.hasAttachment
      ? { ok: false, reason: "no amount in text; screenshot attached", needsReview: true }
      : { ok: false, reason: "no amount found", needsReview: false };
  }

  const questioning = looksLikeAQuestion(text);
  let best: PayoutCandidate | null = null;
  let blocked: string | null = null;
  let unconfirmed = false;

  for (const m of matches) {
    const raw = m[1] ?? m[3];
    const suffix = m[2] ?? m[4];
    const cents = raw ? toCents(raw, suffix) : null;
    if (cents === null) continue;

    const context = contextAround(text, m.index ?? 0, m[0].length);

    const bad = hit(context, DISQUALIFIERS);
    if (bad) {
      blocked = bad;
      continue;
    }

    // Out-of-range amounts are never auto-accepted, however they are worded.
    if (cents < MIN_CENTS || cents > MAX_CENTS) {
      blocked = cents < MIN_CENTS ? "below the plausible floor" : "above the plausible ceiling";
      continue;
    }

    const good = questioning ? null : hit(context, CONFIRMERS);
    if (!good) {
      // A bare number with no payout word. Very often it IS one — people post
      // "$2,500 🔥" and nothing else — but "very often" is not good enough for
      // a public figure, so it goes to review rather than into the total.
      unconfirmed = true;
      continue;
    }

    if (!best || cents > best.amountCents) {
      best = {
        amountCents: cents,
        matched: m[0].trim(),
        reason: `confirmed by "${good}"`,
      };
    }
  }

  if (best) return { ok: true, candidate: best };
  if (unconfirmed) {
    return {
      ok: false,
      reason: questioning
        ? "reads as a question about an amount, not a report of one"
        : "amount found but nothing confirms it is a payout",
      needsReview: true,
    };
  }
  if (blocked) {
    return { ok: false, reason: `context suggests this is not a payout ("${blocked}")`, needsReview: false };
  }
  return { ok: false, reason: "no usable amount", needsReview: false };
}

/** Pretty-prints cents for the channel name and the admin panel. */
export function formatUsd(cents: number, { compact = false } = {}): string {
  const dollars = Math.round(cents / 100);
  if (compact && dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1)}M`;
  }
  if (compact && dollars >= 10_000) {
    return `$${Math.round(dollars / 1000)}K`;
  }
  return `$${dollars.toLocaleString("en-US")}`;
}
