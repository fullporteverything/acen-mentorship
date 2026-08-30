import "server-only";

import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { payoutSyncState, studentPayouts, type StudentPayoutRow } from "@/lib/db/schema";
import type { PayoutStatus } from "./payout-ingest";

/**
 * Storage for the student-payout counter.
 *
 * Self-creating tables (CREATE TABLE IF NOT EXISTS), the same pattern as
 * youtube-announce-store and session-store, so shipping this needs no migration
 * step — the first cron run after deploy creates everything and starts the
 * backfill on its own.
 *
 * The row key is the DISCORD MESSAGE ID. That single choice is what makes the
 * whole thing safe to re-run: the backfill can sweep the channel as many times
 * as it likes, a tick can overlap with the previous one, the state row can be
 * deleted to force a full re-scan — and every message still lands on exactly
 * one row. A public total that double counts on a retry would be worse than no
 * total at all.
 */

let tablesEnsured = false;

export async function ensurePayoutTables(): Promise<void> {
  if (tablesEnsured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS student_payouts (
      message_id varchar(32) PRIMARY KEY,
      channel_id varchar(32) NOT NULL,
      author_discord_id varchar(32) NOT NULL,
      author_name text,
      amount_cents integer,
      matched text,
      reason text,
      status varchar(16) NOT NULL DEFAULT 'pending',
      review_message_id varchar(32),
      decided_by varchar(32),
      decided_at timestamptz,
      posted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Added after the table shipped, so ADD COLUMN IF NOT EXISTS rather than a
  // migration — same self-creating contract as the CREATE above.
  await db.execute(sql`
    ALTER TABLE student_payouts
      ADD COLUMN IF NOT EXISTS attachment_url text,
      ADD COLUMN IF NOT EXISTS vision_kind varchar(24),
      ADD COLUMN IF NOT EXISTS vision_confidence varchar(8),
      ADD COLUMN IF NOT EXISTS vision_at timestamptz
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS student_payouts_status_index ON student_payouts (status)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS student_payouts_review_message_index
      ON student_payouts (review_message_id)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payout_sync_state (
      channel_id varchar(32) PRIMARY KEY,
      last_message_id varchar(32),
      backfill_before_id varchar(32),
      backfill_complete boolean NOT NULL DEFAULT false,
      review_cursor_id varchar(32),
      last_counter_name text,
      last_renamed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  tablesEnsured = true;
}

export interface PayoutSyncState {
  lastMessageId: string | null;
  backfillBeforeId: string | null;
  backfillComplete: boolean;
  reviewCursorId: string | null;
  lastCounterName: string | null;
  lastRenamedAt: Date | null;
}

const EMPTY_STATE: PayoutSyncState = {
  lastMessageId: null,
  backfillBeforeId: null,
  backfillComplete: false,
  reviewCursorId: null,
  lastCounterName: null,
  lastRenamedAt: null,
};

export async function getSyncState(channelId: string): Promise<PayoutSyncState> {
  await ensurePayoutTables();
  const [row] = await db
    .select()
    .from(payoutSyncState)
    .where(eq(payoutSyncState.channelId, channelId))
    .limit(1);
  if (!row) return { ...EMPTY_STATE };
  return {
    lastMessageId: row.lastMessageId ?? null,
    backfillBeforeId: row.backfillBeforeId ?? null,
    backfillComplete: row.backfillComplete,
    reviewCursorId: row.reviewCursorId ?? null,
    lastCounterName: row.lastCounterName ?? null,
    lastRenamedAt: row.lastRenamedAt ?? null,
  };
}

/** Patch-style save: only the fields passed are written. */
export async function saveSyncState(
  channelId: string,
  patch: Partial<PayoutSyncState>
): Promise<void> {
  await ensurePayoutTables();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if ("lastMessageId" in patch) set.lastMessageId = patch.lastMessageId;
  if ("backfillBeforeId" in patch) set.backfillBeforeId = patch.backfillBeforeId;
  if ("backfillComplete" in patch) set.backfillComplete = patch.backfillComplete;
  if ("reviewCursorId" in patch) set.reviewCursorId = patch.reviewCursorId;
  if ("lastCounterName" in patch) set.lastCounterName = patch.lastCounterName;
  if ("lastRenamedAt" in patch) set.lastRenamedAt = patch.lastRenamedAt;

  await db
    .insert(payoutSyncState)
    .values({ channelId, ...set })
    .onConflictDoUpdate({ target: payoutSyncState.channelId, set });
}

/**
 * Forgets where the scanner got to, so the next run re-reads the channel from
 * the beginning. Safe by construction: rows are keyed by message id, so a full
 * re-scan lands on the rows that already exist and re-inserts nothing. Decisions
 * already made survive it.
 */
export async function clearSyncState(channelId: string): Promise<void> {
  await ensurePayoutTables();
  await db.delete(payoutSyncState).where(eq(payoutSyncState.channelId, channelId));
}

export interface CandidateRow {
  messageId: string;
  channelId: string;
  authorDiscordId: string;
  authorName: string | null;
  amountCents: number | null;
  matched: string | null;
  reason: string;
  status: PayoutStatus;
  postedAt: Date | null;
  attachmentUrl: string | null;
}

/**
 * Records a scanned message.
 *
 * DO NOTHING on conflict, never DO UPDATE: once a row exists it may carry a
 * human's decision, and a re-scan re-deriving it from the parser would silently
 * undo that decision. The parser gets one say, at first sight, and never again.
 */
export async function recordCandidates(rows: CandidateRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  await ensurePayoutTables();
  const inserted = await db
    .insert(studentPayouts)
    .values(rows)
    .onConflictDoNothing({ target: studentPayouts.messageId })
    .returning({ messageId: studentPayouts.messageId });
  return inserted.length;
}

/**
 * Rows the bot has not yet shown to a human: everything still pending, plus
 * anything VISION counted on its own.
 *
 * The second half is the point. An auto-counted payout that never appears
 * anywhere is a number moving on a public channel with nobody able to see why
 * or take it back. Posting it makes it reversible — ❌ or a reply removes it.
 */
export function listUnpostedPending(limit: number): Promise<StudentPayoutRow[]> {
  return ensurePayoutTables().then(() =>
    db
      .select()
      .from(studentPayouts)
      .where(
        and(
          isNull(studentPayouts.reviewMessageId),
          or(
            eq(studentPayouts.status, "pending"),
            and(eq(studentPayouts.status, "approved"), eq(studentPayouts.decidedBy, "vision"))
          )
        )
      )
      // Oldest first: the queue drains in the order it filled, so nothing
      // sits at the bottom forever.
      .orderBy(asc(studentPayouts.messageId))
      .limit(limit)
  );
}

/** How long a vision-counted payout stays reversible by reaction. */
const VISION_REVERSAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Posted rows whose reactions are worth polling: anything still pending, plus
 * vision-counted rows inside the reversal window.
 *
 * The window exists because polling costs two API calls per row per tick. An
 * unbounded set of settled rows would grow forever and crowd out the ones
 * actually waiting on an answer.
 */
export function listAwaitingReview(limit: number): Promise<StudentPayoutRow[]> {
  const reversibleSince = new Date(Date.now() - VISION_REVERSAL_WINDOW_MS);
  return ensurePayoutTables().then(() =>
    db
      .select()
      .from(studentPayouts)
      .where(
        and(
          isNotNull(studentPayouts.reviewMessageId),
          or(
            eq(studentPayouts.status, "pending"),
            and(
              eq(studentPayouts.status, "approved"),
              eq(studentPayouts.decidedBy, "vision"),
              gt(studentPayouts.decidedAt, reversibleSince)
            )
          )
        )
      )
      .orderBy(asc(studentPayouts.messageId))
      .limit(limit)
  );
}

/**
 * Pending rows with an image nobody has looked at yet.
 *
 * `visionAt IS NULL` is the whole guard against paying to read the same
 * screenshot on every tick: it is stamped whether the read succeeded, failed,
 * or refused to count anything.
 */
export function listNeedingVision(limit: number): Promise<StudentPayoutRow[]> {
  return ensurePayoutTables().then(() =>
    db
      .select()
      .from(studentPayouts)
      .where(
        and(
          eq(studentPayouts.status, "pending"),
          isNull(studentPayouts.visionAt),
          isNotNull(studentPayouts.attachmentUrl)
        )
      )
      .orderBy(asc(studentPayouts.messageId))
      .limit(limit)
  );
}

/** Records what vision saw, leaving the row pending for a human. */
export async function applyVision(opts: {
  messageId: string;
  kind: string;
  confidence: string;
  amountCents: number | null;
  reason: string;
}): Promise<void> {
  await ensurePayoutTables();
  await db
    .update(studentPayouts)
    .set({
      visionKind: opts.kind,
      visionConfidence: opts.confidence,
      visionAt: new Date(),
      amountCents: opts.amountCents,
      reason: opts.reason,
    })
    .where(and(eq(studentPayouts.messageId, opts.messageId), eq(studentPayouts.status, "pending")));
}

/** Stamps vision as attempted without a verdict, so a failure is not retried forever. */
export async function markVisionAttempted(messageId: string, reason: string): Promise<void> {
  await ensurePayoutTables();
  await db
    .update(studentPayouts)
    .set({ visionAt: new Date(), reason })
    .where(and(eq(studentPayouts.messageId, messageId), eq(studentPayouts.status, "pending")));
}

export async function markReviewPosted(
  messageId: string,
  reviewMessageId: string
): Promise<void> {
  await ensurePayoutTables();
  await db
    .update(studentPayouts)
    .set({ reviewMessageId })
    .where(eq(studentPayouts.messageId, messageId));
}

/**
 * Applies a decision.
 *
 * Scoped to rows still `pending` OR counted by vision — so two reviewers acting
 * at once settle on whichever landed first, while a human can still overrule
 * the machine. A decision a PERSON made is final here; nothing in this file can
 * overwrite it.
 */
export async function resolvePayout(opts: {
  messageId: string;
  status: PayoutStatus;
  amountCents: number | null;
  decidedBy: string;
}): Promise<boolean> {
  await ensurePayoutTables();
  const updated = await db
    .update(studentPayouts)
    .set({
      status: opts.status,
      amountCents: opts.amountCents,
      decidedBy: opts.decidedBy,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(studentPayouts.messageId, opts.messageId),
        or(
          eq(studentPayouts.status, "pending"),
          and(eq(studentPayouts.status, "approved"), eq(studentPayouts.decidedBy, "vision"))
        )
      )
    )
    .returning({ messageId: studentPayouts.messageId });
  return updated.length > 0;
}

export async function findByReviewMessageId(
  reviewMessageId: string
): Promise<StudentPayoutRow | null> {
  await ensurePayoutTables();
  const [row] = await db
    .select()
    .from(studentPayouts)
    .where(eq(studentPayouts.reviewMessageId, reviewMessageId))
    .limit(1);
  return row ?? null;
}

/** The public number. Approved rows only; a null amount contributes nothing. */
export async function totalApprovedCents(): Promise<number> {
  await ensurePayoutTables();
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${studentPayouts.amountCents}), 0)` })
    .from(studentPayouts)
    .where(eq(studentPayouts.status, "approved"));
  const total = Number(row?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

export async function payoutCounts(): Promise<Record<string, number>> {
  await ensurePayoutTables();
  const rows = await db
    .select({ status: studentPayouts.status, n: sql<string>`count(*)` })
    .from(studentPayouts)
    .groupBy(studentPayouts.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
