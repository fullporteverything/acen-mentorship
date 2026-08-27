import "server-only";

import { and, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { members, tableChips, tableGrants } from "@/lib/db/schema";

/**
 * Server-side play-chip bankroll, hand statistics and leaderboard for The
 * Table (house blackjack).
 *
 * PLAY CHIPS ONLY. Chips are cosmetic bragging rights: they are earned by real
 * course progress (see lib/table-earn), never bought, never redeemed, never
 * exchanged for anything of value. There is no purchase path here by design.
 *
 * Tables are self-creating in the onboarding-store style — a module-level
 * boolean short-circuits the DDL after the first call, and every exported
 * function begins with `ensureTableChipsTables()` so production needs no
 * separate migration step.
 */

/** Every new player sits down with this many chips. */
export const DEFAULT_CHIP_BALANCE = 1000;

export interface ChipStats {
  handsPlayed: number;
  handsWon: number;
  handsPushed: number;
  blackjacks: number;
  biggestWin: number;
  totalWagered: number;
}

export interface ChipState {
  balance: number;
  stats: ChipStats;
}

export interface GrantSpec {
  /** Idempotency key — `lesson:<id>`, `journal:<date>`, `daily:<date>`. */
  grantKey: string;
  amount: number;
  /** Human copy for the "you earned chips" toast. Not persisted. */
  label: string;
}

export type GrantedChips = GrantSpec;

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  balance: number;
  handsWon: number;
  /** True for the row belonging to the caller. Never leaks a Discord id. */
  isViewer: boolean;
}

export type HandOutcome = "blackjack" | "win" | "push" | "lose";

/** Per-instance short-circuit so a hot request costs zero DDL round-trips. */
let tableChipsTablesEnsured = false;

/**
 * Idempotently create the chip tables so production gets them with no separate
 * drizzle migration step. Raw CREATE TABLE IF NOT EXISTS matching the drizzle
 * definitions in schema.ts. Runs at most once per process; a failure leaves the
 * flag unset so the next call retries.
 */
export async function ensureTableChipsTables(): Promise<void> {
  if (tableChipsTablesEnsured) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS table_chips (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid NOT NULL REFERENCES members(id),
      discord_id varchar(32) NOT NULL,
      balance integer NOT NULL DEFAULT 1000,
      hands_played integer NOT NULL DEFAULT 0,
      hands_won integer NOT NULL DEFAULT 0,
      hands_pushed integer NOT NULL DEFAULT 0,
      blackjacks integer NOT NULL DEFAULT 0,
      biggest_win integer NOT NULL DEFAULT 0,
      total_wagered integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT table_chips_member_id_unique UNIQUE (member_id)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS table_chips_balance_index ON table_chips (balance)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS table_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      member_id uuid NOT NULL REFERENCES members(id),
      discord_id varchar(32) NOT NULL,
      grant_key varchar(200) NOT NULL,
      amount integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT table_grants_member_grant_key_unique UNIQUE (member_id, grant_key)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS table_grants_member_id_index ON table_grants (member_id)
  `);

  tableChipsTablesEnsured = true;
}

/**
 * Upsert the member row (by discordId, like onboarding-store) so a first-time
 * player always has a members.id to hang chips off.
 */
async function resolveMemberId(
  discordId: string,
  displayName?: string | null
): Promise<string> {
  const [member] = await db
    .insert(members)
    .values({ discordId, displayName: displayName ?? undefined })
    .onConflictDoUpdate({
      target: members.discordId,
      set: { displayName: displayName ?? undefined, updatedAt: new Date(), deletedAt: null },
    })
    .returning({ id: members.id });
  return member.id;
}

function toState(row: {
  balance: number;
  handsPlayed: number;
  handsWon: number;
  handsPushed: number;
  blackjacks: number;
  biggestWin: number;
  totalWagered: number;
}): ChipState {
  return {
    balance: row.balance,
    stats: {
      handsPlayed: row.handsPlayed,
      handsWon: row.handsWon,
      handsPushed: row.handsPushed,
      blackjacks: row.blackjacks,
      biggestWin: row.biggestWin,
      totalWagered: row.totalWagered,
    },
  };
}

const CHIP_COLUMNS = {
  balance: tableChips.balance,
  handsPlayed: tableChips.handsPlayed,
  handsWon: tableChips.handsWon,
  handsPushed: tableChips.handsPushed,
  blackjacks: tableChips.blackjacks,
  biggestWin: tableChips.biggestWin,
  totalWagered: tableChips.totalWagered,
} as const;

/**
 * The member's bankroll + lifetime stats. Creates the row at
 * DEFAULT_CHIP_BALANCE on first read, so "open the table" is enough to be
 * staked. Concurrent first reads collapse onto the unique memberId.
 */
export async function getChipState(
  discordId: string,
  displayName?: string | null
): Promise<ChipState> {
  await ensureTableChipsTables();
  const memberId = await resolveMemberId(discordId, displayName);

  const [created] = await db
    .insert(tableChips)
    .values({ memberId, discordId, balance: DEFAULT_CHIP_BALANCE })
    .onConflictDoNothing({ target: tableChips.memberId })
    .returning(CHIP_COLUMNS);
  if (created) return toState(created);

  const [existing] = await db
    .select(CHIP_COLUMNS)
    .from(tableChips)
    .where(eq(tableChips.memberId, memberId))
    .limit(1);
  return existing
    ? toState(existing)
    : {
        balance: DEFAULT_CHIP_BALANCE,
        stats: {
          handsPlayed: 0,
          handsWon: 0,
          handsPushed: 0,
          blackjacks: 0,
          biggestWin: 0,
          totalWagered: 0,
        },
      };
}

export interface HandResult {
  /** SERVER-computed bankroll change. Never a client-supplied number. */
  delta: number;
  /** Total chips at risk on the hand (doubled stake included). */
  wagered: number;
  outcome: HandOutcome;
}

/**
 * Apply one settled hand to the bankroll and the lifetime counters in a single
 * atomic UPDATE, and return the resulting state. The balance is floored at 0 so
 * a race can never push a player negative.
 */
export async function applyHandResult(
  discordId: string,
  result: HandResult,
  displayName?: string | null
): Promise<ChipState> {
  await ensureTableChipsTables();
  // Guarantees the row exists (and is staked) before the update.
  await getChipState(discordId, displayName);
  const memberId = await resolveMemberId(discordId, displayName);

  const delta = Math.trunc(result.delta);
  const wagered = Math.max(0, Math.trunc(result.wagered));
  const won = result.outcome === "win" || result.outcome === "blackjack" ? 1 : 0;
  const pushed = result.outcome === "push" ? 1 : 0;
  const blackjack = result.outcome === "blackjack" ? 1 : 0;

  const [updated] = await db
    .update(tableChips)
    .set({
      balance: sql`GREATEST(0, ${tableChips.balance} + ${delta})`,
      handsPlayed: sql`${tableChips.handsPlayed} + 1`,
      handsWon: sql`${tableChips.handsWon} + ${won}`,
      handsPushed: sql`${tableChips.handsPushed} + ${pushed}`,
      blackjacks: sql`${tableChips.blackjacks} + ${blackjack}`,
      biggestWin: sql`GREATEST(${tableChips.biggestWin}, ${Math.max(0, delta)})`,
      totalWagered: sql`${tableChips.totalWagered} + ${wagered}`,
      updatedAt: new Date(),
    })
    .where(eq(tableChips.memberId, memberId))
    .returning(CHIP_COLUMNS);

  return updated ? toState(updated) : getChipState(discordId, displayName);
}

/**
 * "The House stakes you." — the broke-player rescue, SERVER-authoritative.
 *
 * Grants a fresh stack ONLY when the member's real balance is below the
 * minimum bet; otherwise it changes nothing and returns the current state
 * with staked=false. The condition lives in the SQL WHERE, so two racing
 * requests cannot both stake. This endpoint existing matters: the client
 * used to grant the stake locally only, which desynced it from the server
 * and made every later settle fail validation (bet > server balance) —
 * silently ending saving for the session.
 */
export const STAKE_AMOUNT = 500;
export const STAKE_BELOW = 25; // the table's minimum bet

export async function stakeIfBroke(
  discordId: string,
  displayName?: string | null
): Promise<{ state: ChipState; staked: boolean }> {
  await ensureTableChipsTables();
  await getChipState(discordId, displayName); // row exists
  const memberId = await resolveMemberId(discordId, displayName);

  const [updated] = await db
    .update(tableChips)
    .set({ balance: STAKE_AMOUNT, updatedAt: new Date() })
    .where(
      and(eq(tableChips.memberId, memberId), lt(tableChips.balance, STAKE_BELOW))
    )
    .returning(CHIP_COLUMNS);

  if (updated) return { state: toState(updated), staked: true };
  return { state: await getChipState(discordId, displayName), staked: false };
}

/**
 * Pay out chips for progress the member has actually made. Every grant carries
 * an idempotency key; the UNIQUE (member_id, grant_key) means an insert for a
 * key that already exists is silently dropped, so a lecture/journal day/daily
 * stipend can NEVER pay twice however often this is called.
 *
 * Only the amounts of the rows that were genuinely inserted are added to the
 * balance, and only those grants are returned (so the UI toasts exactly what
 * was just earned).
 */
export async function claimGrants(
  discordId: string,
  grants: readonly GrantSpec[],
  displayName?: string | null
): Promise<{ granted: GrantedChips[]; state: ChipState }> {
  await ensureTableChipsTables();
  const state = await getChipState(discordId, displayName);
  const memberId = await resolveMemberId(discordId, displayName);

  const payable = grants.filter(
    (grant) => Number.isInteger(grant.amount) && grant.amount > 0 && grant.grantKey.length > 0
  );
  if (payable.length === 0) return { granted: [], state };

  const inserted = await db
    .insert(tableGrants)
    .values(
      payable.map((grant) => ({
        memberId,
        discordId,
        grantKey: grant.grantKey,
        amount: grant.amount,
      }))
    )
    .onConflictDoNothing({ target: [tableGrants.memberId, tableGrants.grantKey] })
    .returning({ grantKey: tableGrants.grantKey, amount: tableGrants.amount });

  if (inserted.length === 0) return { granted: [], state };

  const byKey = new Map(payable.map((grant) => [grant.grantKey, grant]));
  const granted = inserted.map((row) => ({
    grantKey: row.grantKey,
    amount: row.amount,
    label: byKey.get(row.grantKey)?.label ?? "Chips earned",
  }));
  const total = granted.reduce((sum, grant) => sum + grant.amount, 0);

  const [updated] = await db
    .update(tableChips)
    .set({ balance: sql`${tableChips.balance} + ${total}`, updatedAt: new Date() })
    .where(eq(tableChips.memberId, memberId))
    .returning(CHIP_COLUMNS);

  return { granted, state: updated ? toState(updated) : state };
}

/**
 * Top bankrolls, joined to members for the display name. Soft-deleted members
 * are excluded. Discord ids are deliberately NOT selected — nothing that
 * reaches the leaderboard response should identify an account.
 */
/** SQL predicate excluding the house account from player-facing standings. */
function notAdmin() {
  const admin = process.env.ADMIN_DISCORD_ID?.trim();
  return admin ? ne(tableChips.discordId, admin) : undefined;
}

/**
 * Admin-only chip grant — "the House tops up its own rack".
 *
 * Callers MUST have proven they are an admin server-side before reaching this
 * (app/api/table/grant does). Amount is bounded so a typo can't write an
 * absurd number, and the balance is floored at 0 so a negative grant can
 * subtract without going below zero. Admins are excluded from the leaderboard
 * (see getLeaderboard), so this can never distort the players' standings.
 */
export const MAX_GRANT = 1_000_000;

export async function grantChips(
  discordId: string,
  amount: number,
  displayName?: string | null
): Promise<ChipState> {
  await ensureTableChipsTables();
  await getChipState(discordId, displayName);
  const memberId = await resolveMemberId(discordId, displayName);
  const delta = Math.trunc(amount);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > MAX_GRANT) {
    throw new RangeError(`grant must be a non-zero integer within ±${MAX_GRANT}`);
  }

  const [updated] = await db
    .update(tableChips)
    .set({
      balance: sql`GREATEST(0, ${tableChips.balance} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(tableChips.memberId, memberId))
    .returning(CHIP_COLUMNS);

  return updated ? toState(updated) : getChipState(discordId, displayName);
}

export async function getLeaderboard(
  limit = 10,
  viewerDiscordId?: string
): Promise<LeaderboardEntry[]> {
  await ensureTableChipsTables();

  const rows = await db
    .select({
      discordId: tableChips.discordId,
      displayName: members.displayName,
      balance: tableChips.balance,
      handsWon: tableChips.handsWon,
    })
    .from(tableChips)
    .innerJoin(members, eq(members.id, tableChips.memberId))
    // The House does not compete with the players. An admin can grant
    // themselves chips (see grantChips), so leaving them in would park them at
    // #1 forever and make the board meaningless for everyone else.
    .where(and(isNull(members.deletedAt), notAdmin()))
    .orderBy(desc(tableChips.balance), desc(tableChips.handsWon))
    .limit(Math.max(1, Math.min(100, Math.trunc(limit))));

  return rows.map((row, index) => ({
    rank: index + 1,
    displayName: row.displayName?.trim() || "Anonymous",
    balance: row.balance,
    handsWon: row.handsWon,
    isViewer: Boolean(viewerDiscordId) && row.discordId === viewerDiscordId,
  }));
}

/**
 * 1-based standing by balance across all non-deleted members. A member with no
 * chip row yet ranks last (everyone with a row that beats the default, plus
 * one). Ties resolve to the better (lower) rank.
 */
export async function getRank(discordId: string): Promise<number> {
  await ensureTableChipsTables();

  const [own] = await db
    .select({ balance: tableChips.balance })
    .from(tableChips)
    .innerJoin(members, eq(members.id, tableChips.memberId))
    .where(and(eq(tableChips.discordId, discordId), isNull(members.deletedAt)))
    .limit(1);
  const balance = own?.balance ?? DEFAULT_CHIP_BALANCE;

  const [ahead] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tableChips)
    .innerJoin(members, eq(members.id, tableChips.memberId))
    .where(and(gt(tableChips.balance, balance), isNull(members.deletedAt)));

  return (ahead?.count ?? 0) + 1;
}
