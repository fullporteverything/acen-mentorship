import {
  extractAmountCents,
  parsePayoutMessage,
  type PayoutCandidate,
} from "./payout-parse";

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
