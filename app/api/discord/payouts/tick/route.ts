import { NextResponse } from "next/server";

import {
  addReaction,
  fetchMessage,
  fetchMessages,
  fetchReactors,
  getChannel,
  postMessage,
  renameChannel,
  type DiscordMessage,
} from "@/lib/discord-api";
import {
  APPROVE_EMOJI,
  REJECT_EMOJI,
  decideFromReactions,
  decideFromReply,
  decideFromVision,
  decideIngest,
  looksBlind,
  reviewerIds,
} from "@/lib/payout-ingest";
import {
  counterName,
  decisionConfirmation,
  messageLink,
  reviewPostContent,
  shouldRename,
} from "@/lib/payout-counter";
import { formatUsd } from "@/lib/payout-parse";
import {
  applyVision,
  clearSyncState,
  findByReviewMessageId,
  getSyncState,
  listAwaitingReview,
  clearVisionAttempts,
  listNeedingVision,
  listPending,
  listUnconfirmedDecisions,
  listUnpostedPending,
  markConfirmed,
  markVisionAttempted,
  markReviewPosted,
  payoutCounts,
  recordCandidates,
  resolvePayout,
  saveSyncState,
  totalApprovedCents,
  type CandidateRow,
} from "@/lib/payout-store";
import {
  firstReadableImage,
  readPayoutScreenshot,
  visionEnabled,
} from "@/lib/payout-vision";

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
/**
 * Screenshots read per run. Unlike every other budget here this one costs
 * MONEY — a vision call per image — so it is deliberately small and paced. A
 * backfill of a few hundred screenshots drains over a couple of hours instead
 * of arriving as one surprising bill.
 */
const VISION_BUDGET = 8;
/** Acknowledgements per run. Only ever as many as there were decisions. */
const CONFIRM_BUDGET = 10;

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
    // ?diag=1 — reads nothing into the ledger and writes nothing anywhere.
    // Answers the two questions a silent scanner cannot: is this the kind of
    // channel that holds messages, and is Discord actually giving us the text?
    if (url.searchParams.get("diag") === "1") {
      return NextResponse.json(
        await diagnose(sourceChannelId, reviewChannelId, counterChannelId, reviewers)
      );
    }

    // ?reset=1 — forget the cursor so the next run re-reads the whole channel.
    // Harmless to repeat: rows are keyed by message id, so a re-scan re-inserts
    // nothing and cannot disturb a decision already made.
    if (url.searchParams.get("reset") === "1") {
      await clearSyncState(sourceChannelId);
    }

    // ?revision=1 — let vision re-read the pending screenshots. The once-ever
    // guard is right in normal operation but permanently poisons every row a
    // failed run touched; this is the way back.
    const revisioned =
      url.searchParams.get("revision") === "1" ? await clearVisionAttempts() : 0;

    const state = await getSyncState(sourceChannelId);
    const scanned = await scan(sourceChannelId, state.backfillComplete, state);

    // ── 2 RESOLVE ────────────────────────────────────────────────────────────
    const resolved =
      reviewChannelId && !dryRun
        ? await resolveReviews(reviewChannelId, reviewers, state.reviewCursorId)
        : { approved: 0, rejected: 0, reviewCursorId: state.reviewCursorId };

    // ── 3 READ SCREENSHOTS ───────────────────────────────────────────────────
    const vision = dryRun
      ? { read: 0, approved: 0 }
      : await readScreenshots(sourceChannelId);

    // The total is read here, after every decision this run has been applied,
    // so the acknowledgement below and the channel name agree with each other.
    const totalCents = await totalApprovedCents();

    // ── 4 CONFIRM ────────────────────────────────────────────────────────────
    const confirmed =
      reviewChannelId && !dryRun ? await confirmDecisions(reviewChannelId, totalCents) : 0;

    // ── 5 QUEUE ──────────────────────────────────────────────────────────────
    let queued = 0;
    if (reviewChannelId && !dryRun) {
      queued = await postReviews(reviewChannelId, sourceChannelId, guildId);
    }

    // ── 6 RENAME ─────────────────────────────────────────────────────────────
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

    if (!dryRun && !scanned.blind) {
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
      review: {
        queued,
        approved: resolved.approved,
        rejected: resolved.rejected,
        confirmed,
      },
      vision: { enabled: visionEnabled(), ...vision },
      total: formatUsd(totalCents),
      totalCents,
      counter: { desired, renamed, channelConfigured: Boolean(counterChannelId) },
      counts: await payoutCounts(),
      blind: scanned.blind,
      visionRetriesCleared: revisioned,
      notes: [
        scanned.blind
          ? "Discord returned messages with no text and no attachments. That is the Message Content intent being enforced — turn it on in the Developer Portal (Bot → Privileged Gateway Intents), then re-run with &reset=1. Nothing was recorded and the cursor was left where it was."
          : null,
        reviewChannelId ? null : "DISCORD_PAYOUT_REVIEW_CHANNEL_ID unset — unclear posts will queue but never be shown to anyone",
        reviewers.size ? null : "no reviewers configured (PAYOUT_REVIEWER_IDS / ADMIN_DISCORD_ID) — nothing can be approved by hand",
        visionEnabled() ? null : "ANTHROPIC_API_KEY unset — screenshots go to review unread instead of being read automatically",
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
  blind: boolean;
  state: { lastMessageId: string | null; backfillBeforeId: string | null; backfillComplete: boolean };
}> {
  let seen = 0;
  let recorded = 0;
  let blind = false;
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

    // Every message blank means Discord is withholding content, not that the
    // channel is full of empty posts. Stop immediately: reading further would
    // just walk the whole history writing nothing, and finish by marking the
    // backfill complete — which is the state that makes the failure permanent.
    if (looksBlind(batch)) {
      blind = true;
      break;
    }

    const rows: CandidateRow[] = [];
    for (const message of batch) {
      if (isNewer(message.id, newest)) newest = message.id;
      const decision = decideIngest(message);
      // Ignored messages are not stored. The table is a payout ledger, not a
      // copy of the channel, and keeping every "gm" would make the ledger
      // unreadable for the one purpose it exists to serve.
      if (decision.status === "ignored") continue;
      rows.push({
        // Recorded so the row knows there is something to read. The URL itself
        // is signed and expires, so the vision pass re-fetches the message for
        // a fresh one rather than trusting this.
        attachmentUrl: firstReadableImage(message.attachments)?.url ?? null,
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
    blind,
    state: {
      lastMessageId: newest,
      // A blind read learned nothing, so it must not be allowed to record
      // progress of any kind — least of all "backfill complete".
      backfillBeforeId: blind ? state.backfillBeforeId : complete ? null : before,
      backfillComplete: blind ? backfillComplete : complete,
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
    if (!parentId) continue;
    if (!reviewers.has(reply.author.id)) {
      // Someone answered the question and was ignored because they are not on
      // the reviewer list. Silently dropping it is how a correct answer goes
      // missing for an hour with nobody able to see why — say so instead.
      const parentRow = await findByReviewMessageId(parentId);
      if (parentRow && decideFromReply(reply.content, parentRow.amountCents ?? null)) {
        await postMessage(
          reviewChannelId,
          "That looks right, but this account isn't on the payout reviewer list — so it wasn't counted. Add its ID to `PAYOUT_REVIEWER_IDS` to let it decide.",
          reply.id
        ).catch(() => {});
      }
      continue;
    }
    const row = await findByReviewMessageId(parentId);
    // Pending rows, and rows vision counted on its own — a reply is how the
    // owner corrects a number the machine got wrong. A decision a PERSON
    // already made is left alone.
    if (!row) continue;
    if (row.status !== "pending" && !(row.status === "approved" && row.decidedBy === "vision")) {
      continue;
    }
    const decision = decideFromReply(reply.content, row.amountCents ?? null);
    if (!decision) {
      // Say so rather than absorbing it. Silence after a reply is
      // indistinguishable from being ignored, and the reasonable response to
      // being ignored is to give up on the queue.
      await postMessage(
        reviewChannelId,
        "Didn't catch an amount there — reply with a figure like `$2,500` (or just `2500`), or ❌ to skip.",
        reply.id
      ).catch(() => {});
      continue;
    }
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
        autoCounted: row.status === "approved",
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

/** Channel type numbers are meaningless on their own; name them. */
const CHANNEL_KIND: Record<number, string> = {
  0: "text",
  2: "voice",
  4: "category",
  5: "announcement",
  10: "announcement thread",
  11: "public thread",
  12: "private thread",
  13: "stage",
  15: "FORUM",
  16: "MEDIA",
};

/**
 * The "why did it find nothing" report.
 *
 * A scanner that reads an empty list cannot tell you whether the channel is
 * empty, whether it is a forum (whose posts live in threads, not in the channel
 * itself), or whether Discord is withholding message text because the Message
 * Content intent is off. All three look identical from the inside, and all
 * three end with a counter stuck at $0 — so this asks directly.
 */
async function diagnose(
  sourceChannelId: string,
  reviewChannelId: string | null,
  counterChannelId: string | null,
  reviewers: Set<string>
) {
  const describe = async (label: string, id: string | null) => {
    if (!id) return { label, configured: false };
    try {
      const channel = await getChannel(id);
      return {
        label,
        configured: true,
        id,
        name: channel.name,
        type: channel.type,
        kind: CHANNEL_KIND[channel.type] ?? `unknown (${channel.type})`,
      };
    } catch (error) {
      return { label, configured: true, id, error: String(error) };
    }
  };

  const channels = await Promise.all([
    describe("source (payouts)", sourceChannelId),
    describe("review", reviewChannelId),
    describe("counter", counterChannelId),
  ]);

  let sample: unknown[] = [];
  let sampleError: string | null = null;
  try {
    const batch = await fetchMessages(sourceChannelId, { limit: 5 });
    sample = batch.map((m) => ({
      id: m.id,
      author: displayName(m.author),
      bot: Boolean(m.author.bot),
      // The length, not the text. Zero length across the board on messages that
      // clearly had words in them is the signature of the Message Content
      // intent being enforced.
      contentLength: (m.content ?? "").length,
      preview: (m.content ?? "").slice(0, 80),
      attachments: m.attachments?.length ?? 0,
      decision: decideIngest(m),
    }));
  } catch (error) {
    sampleError = String(error);
  }

  // ── why did a reply do nothing? ──────────────────────────────────────────
  // Three things have to line up for a reply to count, and from the outside a
  // failure of any one of them looks identical: the reply has to BE a reply
  // (carry a message_reference), its author has to be a configured reviewer,
  // and the post it answers has to be one we recorded. Show all three.
  let replies: unknown[] = [];
  let replyError: string | null = null;
  if (reviewChannelId) {
    try {
      const recent = await fetchMessages(reviewChannelId, { limit: 15 });
      replies = await Promise.all(
        recent
          .filter((m) => !m.author.bot)
          .map(async (m) => {
            const parentId = m.message_reference?.message_id ?? null;
            const row = parentId ? await findByReviewMessageId(parentId) : null;
            return {
              author: m.author.username,
              authorId: m.author.id,
              isReviewer: reviewers.has(m.author.id),
              content: (m.content ?? "").slice(0, 40),
              repliesToReviewPost: Boolean(parentId),
              matchedRow: row ? { status: row.status, amountCents: row.amountCents } : null,
              wouldDecide: row ? decideFromReply(m.content ?? "", row.amountCents ?? null) : null,
            };
          })
      );
    } catch (error) {
      replyError = String(error);
    }
  }

  // ── why did vision read nothing? ─────────────────────────────────────────
  // Actually performs one read, so the answer is what really happens rather
  // than what ought to. Costs one image.
  let visionProbe: unknown = { skipped: "vision disabled" };
  if (visionEnabled()) {
    const [row] = await listNeedingVision(1);
    if (!row) {
      visionProbe = { skipped: "no pending row awaiting a read" };
    } else {
      try {
        const message = await fetchMessage(sourceChannelId, row.messageId);
        const image = firstReadableImage(message.attachments);
        visionProbe = {
          messageId: row.messageId,
          attachments: message.attachments?.map((a) => ({
            content_type: a.content_type ?? null,
            size: a.size ?? null,
            name: a.filename ?? null,
          })),
          picked: image ? { mediaType: image.mediaType } : null,
          result: image ? await readPayoutScreenshot(image) : "no readable image on the message",
        };
      } catch (error) {
        visionProbe = { messageId: row.messageId, error: String(error) };
      }
    }
  }

  return {
    diag: true,
    channels,
    sampleCount: sample.length,
    sample,
    sampleError,
    reviewers: reviewers.size,
    replies,
    replyError,
    visionProbe,
    // What is actually stored on the rows waiting for a human — including the
    // reason vision gave up, which is otherwise invisible once the review post
    // has already been made.
    pending: (await listPending(10)).map((row) => ({
      messageId: row.messageId,
      author: row.authorName,
      amountCents: row.amountCents,
      reason: row.reason,
      visionKind: row.visionKind,
      visionConfidence: row.visionConfidence,
      visionTried: Boolean(row.visionAt),
    })),
    state: await getSyncState(sourceChannelId),
    counts: await payoutCounts(),
    reading: sample.length === 0
      ? "The payouts channel returned no messages. If its kind above is FORUM or MEDIA, that is the cause: posts live in threads, not in the channel itself."
      : sample.every((m) => (m as { contentLength: number }).contentLength === 0)
        ? "Messages came back with no text. That is the Message Content intent being enforced — switch it on in the Discord Developer Portal."
        : "Messages and text are both coming through; the parser's decisions are shown per message above.",
  };
}

/**
 * Step 3 — read the screenshots nobody has read yet.
 *
 * Most posts in a payouts channel are a picture and nothing else, so this is
 * the difference between a counter that maintains itself and a queue of things
 * for the owner to type in. What it is NOT allowed to do is decide on its own
 * that a balance screenshot is a payout — see decideFromVision.
 */
async function readScreenshots(
  sourceChannelId: string
): Promise<{ read: number; approved: number }> {
  if (!visionEnabled()) return { read: 0, approved: 0 };

  const queue = await listNeedingVision(VISION_BUDGET);
  let read = 0;
  let approved = 0;

  for (const row of queue) {
    // Re-fetch for a fresh CDN link: Discord signs attachment URLs and they
    // expire, so the one stored at scan time is usually already dead.
    let image: { url: string; mediaType: string } | null = null;
    try {
      const message = await fetchMessage(sourceChannelId, row.messageId);
      image = firstReadableImage(message.attachments);
    } catch {
      // Deleted message, or the channel moved. Stamp it so we stop retrying.
      await markVisionAttempted(row.messageId, "screenshot could not be fetched");
      continue;
    }
    if (!image) {
      await markVisionAttempted(row.messageId, "no readable image on the message");
      continue;
    }

    const result = await readPayoutScreenshot(image);
    if (!result.ok) {
      // The reason goes on the row, so a broken integration is distinguishable
      // from a screenshot that genuinely has no amount on it.
      await markVisionAttempted(row.messageId, `screenshot could not be read — ${result.error}`);
      continue;
    }
    const reading = result.reading;
    read += 1;

    const decision = decideFromVision(reading);
    if (decision.status === "approved" && decision.amountCents !== null) {
      const ok = await resolvePayout({
        messageId: row.messageId,
        status: "approved",
        amountCents: decision.amountCents,
        // Recorded as the decider so the audit trail never implies a human
        // signed off on a number no human ever saw.
        decidedBy: "vision",
      });
      if (ok) approved += 1;
      // Stamped either way, so a row that lost a race is not re-read tomorrow.
      await markVisionAttempted(row.messageId, decision.note);
      continue;
    }

    await applyVision({
      messageId: row.messageId,
      kind: reading.kind,
      confidence: reading.confidence,
      amountCents: decision.amountCents,
      reason: decision.note,
    });
  }

  return { read, approved };
}

/**
 * Step 4 — tell the reviewer their decision landed.
 *
 * Replying "$2,500" to a review post used to be met with silence: nothing
 * happened in the channel, and the only evidence it worked was the channel name
 * changing ten minutes later. The honest reading of that silence is "it ignored
 * me", so the next thing a person does is reply again — or stop using the queue.
 *
 * The acknowledgement quotes the figure AND the new running total, because what
 * is really being checked is not that the bot heard something, but that it took
 * the right number rather than quietly keeping its own guess.
 *
 * Stamped after posting: a duplicate acknowledgement is noise, but a missing one
 * is the exact problem this fixes, so the order favours re-sending over losing.
 */
async function confirmDecisions(
  reviewChannelId: string,
  totalCents: number
): Promise<number> {
  const pending = await listUnconfirmedDecisions(CONFIRM_BUDGET);
  let sent = 0;
  for (const row of pending) {
    if (!row.reviewMessageId) continue;
    try {
      await postMessage(
        reviewChannelId,
        decisionConfirmation({
          status: row.status === "approved" ? "approved" : "rejected",
          amountCents: row.amountCents ?? null,
          totalCents,
        }),
        row.reviewMessageId
      );
    } catch {
      // Leave it unconfirmed and try again next run.
      continue;
    }
    await markConfirmed(row.messageId);
    sent += 1;
  }
  return sent;
}
