import { NextResponse } from "next/server";

import {
  addReaction,
  fetchMessages,
  fetchReactors,
  postMessage,
  renameChannel,
  type DiscordMessage,
} from "@/lib/discord-api";
import {
  APPROVE_EMOJI,
  REJECT_EMOJI,
  decideFromReactions,
  decideFromReply,
  decideIngest,
  reviewerIds,
} from "@/lib/payout-ingest";
import {
  counterName,
  messageLink,
  reviewPostContent,
  shouldRename,
} from "@/lib/payout-counter";
import { formatUsd } from "@/lib/payout-parse";
import {
  findByReviewMessageId,
  getSyncState,
  listAwaitingReview,
  listUnpostedPending,
  markReviewPosted,
  payoutCounts,
  recordCandidates,
  resolvePayout,
  saveSyncState,
  totalApprovedCents,
  type CandidateRow,
} from "@/lib/payout-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/discord/payouts/tick
 *
 * The entire student-payout counter, in one scheduled pass. It lives here and
 * NOWHERE ELSE — nothing about this feature appears on the website, by design:
 * the counter is a Discord thing, the review queue is a Discord thing, and the
 * only interface anyone touches is the server itself.
 *
 * Each run does four things, in this order:
 *
 *   1 SCAN     the payouts channel. First run has no cursor, so it walks the
 *              WHOLE history backwards — that is the "scan what's already
 *              there" pass, and it resumes across runs so a big channel cannot
 *              blow the function timeout. After that it only reads what is new.
 *   2 RESOLVE  review decisions: ✅/❌ reactions, and replies carrying an amount.
 *   3 QUEUE    a few of the unclear ones into the review channel.
 *   4 RENAME   the counter channel, but only when the visible text changed and
 *              only once per run — Discord allows 2 renames per 10 minutes and
 *              punishes greed by silently ignoring the rename.
 *
 * Auth: CRON_SECRET as `Authorization: Bearer <secret>` (what Vercel Cron
 * sends) or `?key=<secret>`, matching /api/youtube/poll. No secret configured
 * means the route refuses to run at all, so it can never be hit anonymously.
 *
 * Dormant until configured: with the env vars unset it returns 200 `{ skipped }`
 * and touches nothing.
 */

/** Pages of 100 messages per run. 20 keeps a big backfill inside the timeout. */
const MAX_BACKFILL_PAGES = 20;
const MAX_INCREMENTAL_PAGES = 5;
/**
 * How many review posts one run may make. Small on purpose: the first backfill
 * of a busy channel can turn up hundreds of unclear messages, and dumping them
 * all at once would both hammer the rate limit and produce a queue nobody will
 * ever open. A handful per run drains steadily instead.
 */
const REVIEW_POST_BUDGET = 5;
/** Reaction polling costs 2 API calls per row, so cap what one run checks. */
const REVIEW_POLL_BUDGET = 15;

/** Snowflakes are numeric strings; longer wins, then lexicographic. */
function isNewer(a: string, b: string | null | undefined): boolean {
  if (!b) return true;
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

function displayName(author: DiscordMessage["author"]): string {
  return author.global_name?.trim() || author.username || "member";
}

export async function GET(req: Request) {
  // Trimmed on BOTH sides. Pasting a secret into a dashboard field or a shell
  // picks up a trailing space or newline about half the time, and an exact
  // comparison turns that into a 401 that looks identical to a wrong secret —
  // which sends you hunting for the wrong problem.
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const url = new URL(req.url);
  const presented = (
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key")
  )?.trim();
  if (presented !== secret) {
    return NextResponse.json(
      {
        error: "unauthorized",
        // Says nothing about the secret itself, but names the cause that is
        // right nine times out of ten: env vars are baked into a deployment at
        // build time, so changing CRON_SECRET does nothing until a redeploy.
        hint: "CRON_SECRET is set, but the key presented does not match it. If you changed it recently, redeploy — env vars only reach a deployment when it is built.",
      },
      { status: 401 }
    );
  }

  const sourceChannelId = process.env.DISCORD_PAYOUT_CHANNEL_ID?.trim();
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!sourceChannelId || !botToken) {
    return NextResponse.json({ skipped: "payout counter not configured" });
  }

  const reviewChannelId = process.env.DISCORD_PAYOUT_REVIEW_CHANNEL_ID?.trim() || null;
  const counterChannelId = process.env.DISCORD_PAYOUT_COUNTER_CHANNEL_ID?.trim() || null;
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const reviewers = reviewerIds();
  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const state = await getSyncState(sourceChannelId);
    const scanned = await scan(sourceChannelId, state.backfillComplete, state);

    // ── 2 RESOLVE ────────────────────────────────────────────────────────────
    const resolved =
      reviewChannelId && !dryRun
        ? await resolveReviews(reviewChannelId, reviewers, state.reviewCursorId)
        : { approved: 0, rejected: 0, reviewCursorId: state.reviewCursorId };

    // ── 3 QUEUE ──────────────────────────────────────────────────────────────
    let queued = 0;
    if (reviewChannelId && !dryRun) {
      queued = await postReviews(reviewChannelId, sourceChannelId, guildId);
    }

    // ── 4 RENAME ─────────────────────────────────────────────────────────────
    const totalCents = await totalApprovedCents();
    const desired = counterName(totalCents, process.env.DISCORD_PAYOUT_COUNTER_TEMPLATE);
    let renamed = false;
    if (
      counterChannelId &&
      !dryRun &&
      shouldRename({
        desired,
        current: state.lastCounterName,
        lastRenamedAt: state.lastRenamedAt,
      })
    ) {
      await renameChannel(counterChannelId, desired);
      renamed = true;
    }

    if (!dryRun) {
      await saveSyncState(sourceChannelId, {
        ...scanned.state,
        reviewCursorId: resolved.reviewCursorId,
        ...(renamed ? { lastCounterName: desired, lastRenamedAt: new Date() } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      mode: state.backfillComplete ? "incremental" : "backfill",
      dryRun,
      scanned: scanned.seen,
      recorded: scanned.recorded,
      backfillComplete: scanned.state.backfillComplete,
      review: { queued, approved: resolved.approved, rejected: resolved.rejected },
      total: formatUsd(totalCents),
      totalCents,
      counter: { desired, renamed, channelConfigured: Boolean(counterChannelId) },
      counts: await payoutCounts(),
      notes: [
        reviewChannelId ? null : "DISCORD_PAYOUT_REVIEW_CHANNEL_ID unset — unclear posts will queue but never be shown to anyone",
        reviewers.size ? null : "no reviewers configured (PAYOUT_REVIEWER_IDS / ADMIN_DISCORD_ID) — nothing can be approved by hand",
      ].filter(Boolean),
    });
  } catch (error) {
    // Secret-gated, so echoing the detail is safe and makes a 10-minute cron
    // debuggable from the response alone.
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * Step 1 — read the channel.
 *
 * Backfill walks BACKWARD from the newest message using `before`, storing how
 * far it got, so a channel with ten thousand messages finishes over several
 * runs rather than timing out forever on the first. Incremental walks FORWARD
 * from the newest id we have seen using `after`.
 */
async function scan(
  channelId: string,
  backfillComplete: boolean,
  state: { lastMessageId: string | null; backfillBeforeId: string | null }
): Promise<{
  seen: number;
  recorded: number;
  state: { lastMessageId: string | null; backfillBeforeId: string | null; backfillComplete: boolean };
}> {
  let seen = 0;
  let recorded = 0;
  let newest = state.lastMessageId;
  let before = state.backfillBeforeId;
  let complete = backfillComplete;

  // Direction is fixed for the whole run. It is read from the state we STARTED
  // with, never from `complete` — that flips to true the moment the backfill
  // finishes, and letting it steer the loop would turn the last page of a
  // backfill into a forward scan halfway through.
  const incremental = backfillComplete;
  const pages = incremental ? MAX_INCREMENTAL_PAGES : MAX_BACKFILL_PAGES;
  let after = incremental ? state.lastMessageId ?? undefined : undefined;

  for (let page = 0; page < pages; page += 1) {
    const batch = await fetchMessages(channelId, {
      limit: 100,
      ...(incremental ? (after ? { after } : {}) : before ? { before } : {}),
    });
    if (batch.length === 0) {
      // Nothing left in this direction. For a backfill that means done; for an
      // incremental pass it just means no new messages.
      if (!complete) complete = true;
      break;
    }
    seen += batch.length;

    const rows: CandidateRow[] = [];
    for (const message of batch) {
      if (isNewer(message.id, newest)) newest = message.id;
      const decision = decideIngest(message);
      // Ignored messages are not stored. The table is a payout ledger, not a
      // copy of the channel, and keeping every "gm" would make the ledger
      // unreadable for the one purpose it exists to serve.
      if (decision.status === "ignored") continue;
      rows.push({
        messageId: message.id,
        channelId,
        authorDiscordId: message.author.id,
        authorName: displayName(message.author),
        amountCents: decision.amountCents,
        matched: decision.matched,
        reason: decision.reason,
        status: decision.status,
        postedAt: new Date(message.timestamp),
      });
    }
    recorded += await recordCandidates(rows);

    if (incremental) {
      // Forward paging: the frontier is the newest id in the batch.
      after = batch.reduce((acc, m) => (isNewer(m.id, acc) ? m.id : acc), batch[0].id);
    } else {
      // Backward paging: the frontier is the oldest id in the batch.
      before = batch.reduce((acc, m) => (isNewer(m.id, acc) ? acc : m.id), batch[0].id);
    }
    if (batch.length < 100) {
      if (!complete) complete = true;
      break;
    }
  }

  return {
    seen,
    recorded,
    state: {
      lastMessageId: newest,
      backfillBeforeId: complete ? null : before,
      backfillComplete: complete,
    },
  };
}

/**
 * Step 2 — turn reviewer input into decisions.
 *
 * Two channels of input, because one is not enough: a ✅ answers "is this a
 * payout?" but cannot answer "how much?" for a screenshot with no text. Replies
 * cover that, and also let a reviewer correct a number the parser misread.
 */
async function resolveReviews(
  reviewChannelId: string,
  reviewers: Set<string>,
  reviewCursorId: string | null
): Promise<{ approved: number; rejected: number; reviewCursorId: string | null }> {
  let approved = 0;
  let rejected = 0;
  let cursor = reviewCursorId;

  if (reviewers.size === 0) return { approved, rejected, reviewCursorId: cursor };

  // ── replies ──────────────────────────────────────────────────────────────
  const replies = await fetchMessages(reviewChannelId, {
    limit: 100,
    ...(reviewCursorId ? { after: reviewCursorId } : {}),
  });
  for (const reply of replies) {
    if (isNewer(reply.id, cursor)) cursor = reply.id;
    const parentId = reply.message_reference?.message_id;
    if (!parentId || !reviewers.has(reply.author.id)) continue;
    const row = await findByReviewMessageId(parentId);
    if (!row || row.status !== "pending") continue;
    const decision = decideFromReply(reply.content, row.amountCents ?? null);
    if (!decision) continue;
    const ok = await resolvePayout({
      messageId: row.messageId,
      status: decision.status,
      amountCents: decision.amountCents,
      decidedBy: reply.author.id,
    });
    if (!ok) continue;
    if (decision.status === "approved") approved += 1;
    else rejected += 1;
  }

  // ── reactions ────────────────────────────────────────────────────────────
  const waiting = await listAwaitingReview(REVIEW_POLL_BUDGET);
  for (const row of waiting) {
    if (!row.reviewMessageId) continue;
    const [yes, no] = await Promise.all([
      fetchReactors(reviewChannelId, row.reviewMessageId, APPROVE_EMOJI).catch(() => []),
      fetchReactors(reviewChannelId, row.reviewMessageId, REJECT_EMOJI).catch(() => []),
    ]);
    const decision = decideFromReactions({
      approvers: yes.map((u) => u.id),
      rejecters: no.map((u) => u.id),
      reviewers,
      knownAmountCents: row.amountCents ?? null,
    });
    if (!decision) continue;
    const ok = await resolvePayout({
      messageId: row.messageId,
      status: decision.status,
      amountCents: decision.status === "approved" ? row.amountCents ?? null : null,
      decidedBy: decision.decidedBy,
    });
    if (!ok) continue;
    if (decision.status === "approved") approved += 1;
    else rejected += 1;
  }

  return { approved, rejected, reviewCursorId: cursor };
}

/** Step 3 — show a few unclear messages to a human, with ✅/❌ ready to press. */
async function postReviews(
  reviewChannelId: string,
  sourceChannelId: string,
  guildId: string | undefined
): Promise<number> {
  const queue = await listUnpostedPending(REVIEW_POST_BUDGET);
  let queued = 0;
  for (const row of queue) {
    const posted = await postMessage(
      reviewChannelId,
      reviewPostContent({
        authorName: row.authorName || "member",
        amountCents: row.amountCents ?? null,
        reason: row.reason || "needs a look",
        messageLink: messageLink(guildId, sourceChannelId, row.messageId),
      })
    );
    // Recorded BEFORE the reactions are seeded. If seeding fails, the row is
    // still linked to a real post a reviewer can react to by hand; the other
    // order would leave an orphan post and re-queue the same payout forever.
    await markReviewPosted(row.messageId, posted.id);
    queued += 1;
    await addReaction(reviewChannelId, posted.id, APPROVE_EMOJI).catch(() => {});
    await addReaction(reviewChannelId, posted.id, REJECT_EMOJI).catch(() => {});
  }
  return queued;
}
