import { NextResponse } from "next/server";

import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { recordAuditEvent } from "@/lib/audit";
import { MAX_GRANT, grantChips } from "@/lib/table-chips-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/table/grant   { amount: number }
 * "The House tops up its own rack." ADMIN ONLY.
 *
 * The authorisation here is `requireAdminOrResponse` — a real server-side
 * check against the session and ADMIN_DISCORD_ID. It is NOT the console's
 * passphrase, which is a client-side convenience and proves nothing. A member
 * calling this endpoint directly gets a 403 no matter what they send.
 *
 * Grants are audited, and admins are excluded from the leaderboard, so this
 * cannot distort the players' standings. Play chips only — no purchase, no
 * cash-out, nothing of value.
 */
export async function POST(req: Request) {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "table.grant", req, undefined, {
    limit: 60,
    windowMs: 3_600_000,
  });
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const amount = (body as { amount?: unknown })?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
  }
  const delta = Math.trunc(amount);
  if (delta === 0 || Math.abs(delta) > MAX_GRANT) {
    return NextResponse.json(
      { error: `amount must be a non-zero integer within ±${MAX_GRANT}` },
      { status: 400 }
    );
  }

  const state = await grantChips(admin.discordId, delta, admin.name);
  await recordAuditEvent({
    action: "table.grant",
    resourceType: "table_chips",
    actorDiscordId: admin.discordId,
    details: { delta, balance: state.balance },
  }).catch(() => {});

  return NextResponse.json({ balance: state.balance, stats: state.stats, granted: delta });
}
