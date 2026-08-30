import {
  extractAmountCents,
  parsePayoutMessage,
  type PayoutCandidate,
} from "./payout-parse";
import type { VisionReading } from "./payout-vision";

/**
 * SUITE 7 — THE PURE HALF OF THE PAYOUT COUNTER.
 *
 * Everything in here is a decision, not an effect: no database, no Discord, no
 * clock it does not get handed. That is deliberate — CI has neither a Neon URL
 * nor a bot token, and the rules that decide what goes on a public number are
 * exactly the part that must be tested. lib/payout-store does the writing,
 * app/api/discord/payouts/tick does the talking.
 */

export type PayoutStatus = "approved" | "pending" | "rejected" | "ignored";

export interface IngestedMessage {
  id: string;
  content: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  timestamp: string;
  attachments: { id: string; url: string }[];
}

export interface IngestDecision {
  status: PayoutStatus;
  amountCents: number | null;
  matched: string | null;
  reason: string;
}

/**
 * What to do with one message from the payouts channel.
 *
 * Three outcomes and no fourth:
 *   approved  the parser is confident; it counts immediately
 *   pending   there is something a human should look at
 *   ignored   placed as not-a-payout; nobody is asked about it
 *
 * "ignored" is doing the important work. A payouts channel is still a channel —
 * people chat in it. Without this, every "gm" and "what pair you on" would land
 * in the review queue and the queue would be abandoned inside a week, which in
 * practice means the counter stops being maintained at all.
 */
export function decideIngest(message: IngestedMessage): IngestDecision {
  // The bot's own review posts and announcement embeds live in these channels
  // too. Reading its own output back in would be a feedback loop.
  if (message.author?.bot) {
    return { status: "ignored", amountCents: null, matched: null, reason: "bot message" };
  }

  const hasAttachment = (message.attachments?.length ?? 0) > 0;
  const result = parsePayoutMessage(message.content ?? "", { hasAttachment });

  if (result.ok) {
    const candidate: PayoutCandidate = result.candidate;
    return {
      status: "approved",
      amountCents: candidate.amountCents,
      matched: candidate.matched,
      reason: candidate.reason,
    };
  }

  if (result.needsReview) {
    // An amount may or may not exist here: "$2,500 🔥" has one and only lacks a
    // payout word; a bare screenshot has none at all. Carrying whatever number
    // is present means the reviewer usually only has to press ✅.
    return {
      status: "pending",
      amountCents: extractAmountCents(message.content ?? ""),
      matched: null,
      reason: result.reason,
    };
  }

  return { status: "ignored", amountCents: null, matched: null, reason: result.reason };
}

/**
 * Is Discord handing us blank messages?
 *
 * With the Message Content intent off, a bot reading a channel gets real
 * messages — ids, authors, timestamps — with `content` and `attachments`
 * stripped to nothing. Every one of them then parses as "empty message" and is
 * ignored, so the scan looks like a channel full of chatter with no payouts in
 * it: no error, no warning, a counter sitting at $0 forever, and a backfill
 * marked complete so it never tries again.
 *
 * That is the worst kind of failure — a confident wrong answer — and it is
 * cheap to detect. A real channel does not consist entirely of messages with no
 * text AND no attachment. Requires a few messages before calling it, so a quiet
 * channel with one sticker in it is never mistaken for a blind read.
 */
export function looksBlind(
  messages: readonly { content?: string; attachments?: unknown[] }[]
): boolean {
  if (messages.length < 3) return false;
  return messages.every(
    (m) => (m.content ?? "").length === 0 && (m.attachments?.length ?? 0) === 0
  );
}

/** The same sanity bounds the text parser uses. Outside these, a human looks. */
export const VISION_MIN_CENTS = 5_00;
export const VISION_MAX_CENTS = 500_000_00;

/**
 * What a screenshot reading is allowed to do.
 *
 * The rule is narrow on purpose: a reading counts itself ONLY when the model
 * says the screenshot is a payout confirmation, says so with high confidence,
 * and produces an amount inside the plausible range. Everything else keeps its
 * number as a suggestion and still goes in front of a human.
 *
 * The reason is the failure mode, not the accuracy rate. A misread payout is
 * off by a bit; a confidently-read ACCOUNT BALANCE is a $50,000 account size
 * added to a public claim about what students have withdrawn. Those are not the
 * same kind of wrong, so the classification — not the OCR — is what gates it.
 */
export function decideFromVision(reading: VisionReading): {
  status: PayoutStatus;
  amountCents: number | null;
  note: string;
} {
  const amount =
    reading.amountCents !== null &&
    reading.amountCents >= VISION_MIN_CENTS &&
    reading.amountCents <= VISION_MAX_CENTS
      ? reading.amountCents
      : null;

  if (reading.kind === "payout_confirmation" && reading.confidence === "high" && amount !== null) {
    return { status: "approved", amountCents: amount, note: `read from screenshot: ${reading.evidence}` };
  }

  const why =
    reading.kind !== "payout_confirmation"
      ? `screenshot looks like ${reading.kind.replace(/_/g, " ")}, not a payout`
      : amount === null
        ? "no plausible amount readable"
        : `only ${reading.confidence} confidence`;
  // The suggestion rides along even when it is not trusted — a reviewer
  // pressing ✅ on a pre-filled number is the difference between a queue that
  // gets cleared and one that does not.
  return { status: "pending", amountCents: amount, note: `${why} (read: ${reading.evidence})` };
}

export const APPROVE_EMOJI = "✅";
export const REJECT_EMOJI = "❌";

/**
 * Turns a reviewer's REPLY to a review post into a decision.
 *
 * Replies exist because reactions alone cannot answer a screenshot: ✅ on a post
 * with no number would approve nothing. Typing the figure is the one thing a
 * reaction cannot express, so it is the one thing replies are for.
 */
export function decideFromReply(
  content: string,
  knownAmountCents: number | null
): { status: PayoutStatus; amountCents: number | null } | null {
  const text = (content ?? "").trim();
  if (!text) return null;

  if (/^(no|nope|nah|reject|skip|ignore|❌|✖️|x)\b/i.test(text) || text === "❌") {
    return { status: "rejected", amountCents: null };
  }

  const typed = extractAmountCents(text);
  if (typed !== null) return { status: "approved", amountCents: typed };

  // A bare "yes" only means something when there is already a number to say
  // yes TO. Otherwise it is an approval of nothing, and approving nothing
  // would quietly close the row at zero and lose the payout for good.
  if (/^(yes|yep|yeah|approve|ok|okay|✅)\b/i.test(text) || text === "✅") {
    return knownAmountCents !== null
      ? { status: "approved", amountCents: knownAmountCents }
      : null;
  }

  return null;
}

/**
 * Reads reactions on a review post. Only ids in `reviewers` count — the review
 * channel should be staff-only anyway, but a permission mistake in Discord must
 * not be able to move a public figure, so this checks rather than assumes.
 *
 * ❌ beats ✅. If both were pressed somebody is unsure, and the safe reading of
 * "unsure" for a number the owner may have to defend is: leave it out.
 */
export function decideFromReactions(opts: {
  approvers: string[];
  rejecters: string[];
  reviewers: Set<string>;
  knownAmountCents: number | null;
}): { status: PayoutStatus; decidedBy: string } | null {
  const reject = opts.rejecters.find((id) => opts.reviewers.has(id));
  if (reject) return { status: "rejected", decidedBy: reject };

  const approve = opts.approvers.find((id) => opts.reviewers.has(id));
  // Same rule as the reply path: ✅ on a row with no amount approves nothing.
  // It stays pending until a reviewer supplies the number.
  if (approve && opts.knownAmountCents !== null) {
    return { status: "approved", decidedBy: approve };
  }
  return null;
}

/** Who is allowed to approve. No env set means nobody — fails closed. */
export function reviewerIds(
  env: Record<string, string | undefined> = process.env
): Set<string> {
  const raw = [env.PAYOUT_REVIEWER_IDS, env.ADMIN_DISCORD_ID]
    .filter(Boolean)
    .join(",");
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}
