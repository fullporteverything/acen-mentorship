import { NextResponse } from "next/server";

import {
  BASELINE_WINDOW_DAYS,
  computeBaseline,
} from "@/lib/session-baseline";
import {
  accountsWithSightings,
  getBaseline,
  pruneSightings,
  putBaseline,
  recentSightings,
} from "@/lib/session-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/security/baseline/rebuild
 *
 * Nightly job. Rebuilds every active account's behavioural profile from its
 * heartbeat history, then prunes history that has aged out of the window.
 *
 * Auth: the CRON_SECRET, as `Authorization: Bearer <secret>` (what Vercel Cron
 * sends) or `?key=<secret>` — same contract as /api/youtube/poll. Without a
 * configured secret the route refuses to run, so it can never be triggered
 * anonymously.
 *
 * Why a nightly rebuild rather than updating profiles as beats arrive:
 *   - It is PURE and restartable. The profile is a function of the history, so
 *     a failed run costs nothing and the next one produces the same answer.
 *     Incremental updates drift, and drift in this particular number quietly
 *     changes who gets flagged.
 *   - It keeps the heartbeat path cheap. That path runs once a minute per
 *     member and must never become the slow thing.
 *   - It is auditable. You can re-run it against the same history and get the
 *     same profiles, which matters if anyone ever asks why an account was
 *     flagged.
 *
 * Nothing here can revoke anything. It only writes derived numbers.
 */

const WINDOW_MS = BASELINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Sightings are pruned one window BEYOND what the rebuild reads, so a run that
 * fails for a few days doesn't come back to find the history it needed already
 * deleted.
 */
const PRUNE_MS = WINDOW_MS * 2;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("key");
  if (presented !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let accounts: string[];
  try {
    accounts = await accountsWithSightings(WINDOW_MS);
  } catch (error) {
    console.error("baseline rebuild: could not list accounts", error);
    return NextResponse.json({ error: "rebuild failed" }, { status: 500 });
  }

  let rebuilt = 0;
  let failed = 0;
  for (const discordId of accounts) {
    try {
      const [sightings, previous] = await Promise.all([
        recentSightings(discordId, WINDOW_MS),
        getBaseline(discordId),
      ]);
      // `previous` is passed so growth stays rate-limited — see
      // BASELINE_MAX_GROWTH_PER_REBUILD. Without it an account being shared
      // from day one would simply teach the profile that five devices is
      // normal, and the watch would never fire again.
      const baseline = computeBaseline(sightings, {
        windowMs: 30 * 60_000,
        previous,
      });
      await putBaseline(discordId, baseline);
      rebuilt += 1;
    } catch (error) {
      // One bad account must not abandon the rest of the roster.
      failed += 1;
      console.error(`baseline rebuild: failed for ${discordId}`, error);
    }
  }

  let pruned = 0;
  try {
    pruned = await pruneSightings(PRUNE_MS);
  } catch (error) {
    console.error("baseline rebuild: prune failed", error);
  }

  return NextResponse.json({ accounts: accounts.length, rebuilt, failed, pruned });
}
