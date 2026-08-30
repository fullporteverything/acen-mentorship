import { NextResponse } from "next/server";

import {
  INTERACTION_COMMAND,
  INTERACTION_PING,
  messageReply,
  paidResponseContent,
  pongReply,
  verifyDiscordSignature,
} from "@/lib/discord-interactions";
import { totalApprovedCents } from "@/lib/payout-store";

export const dynamic = "force-dynamic";
/** node:crypto for Ed25519 — this cannot run on the edge runtime. */
export const runtime = "nodejs";

/**
 * POST /api/discord/interactions — where Discord sends slash commands.
 *
 * ⏱ THE 3-SECOND RULE. Discord abandons an interaction that has not been
 * answered within three seconds and shows the user "the application did not
 * respond". Everything below is written around that: the total is raced against
 * a timeout, and a slow database costs the reader the figure rather than the
 * whole reply.
 */
/**
 * GET /api/discord/interactions?key=CRON_SECRET — is this endpoint set up?
 *
 * "The application did not respond" is Discord's message for every failure on
 * this path: no endpoint URL configured, a wrong public key, a route that 500s,
 * a cold start over three seconds. They are indistinguishable from the Discord
 * side, so this answers the half that lives on ours.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const url = new URL(req.url);
  const presented = (
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key")
  )?.trim();
  if (!secret || presented !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const key = process.env.DISCORD_PUBLIC_KEY?.trim();
  // Shape only. A Discord application's public key is not a secret — it is
  // published in the portal — but there is no reason to echo it either.
  const looksRight = Boolean(key && /^[0-9a-f]{64}$/i.test(key));
  return NextResponse.json({
    endpoint: "ready",
    publicKeyConfigured: Boolean(key),
    publicKeyLength: key?.length ?? 0,
    publicKeyLooksValid: looksRight,
    // Verification is exercised for real: a key that cannot be imported fails
    // every request, and this catches that here rather than in Discord.
    verifierUsable: looksRight
      ? verifyDiscordSignature({
          rawBody: "{}",
          signature: "00".repeat(64),
          timestamp: "0",
          publicKey: key,
        }) === false
      : false,
    next: looksRight
      ? "Set Interactions Endpoint URL in the Developer Portal to this URL (without the ?key=)."
      : "Set DISCORD_PUBLIC_KEY (Developer Portal → General Information → Public Key), then redeploy.",
  });
}

export async function POST(req: Request) {
  // Read the RAW body — the signature covers the exact bytes Discord sent, so
  // parsing first and re-serializing would break verification.
  const rawBody = await req.text();

  const ok = verifyDiscordSignature({
    rawBody,
    signature: req.headers.get("x-signature-ed25519"),
    timestamp: req.headers.get("x-signature-timestamp"),
    publicKey: process.env.DISCORD_PUBLIC_KEY,
  });
  // 401 is required, not merely tidy: Discord sends deliberately invalid
  // requests when the endpoint is registered and refuses a URL that accepts
  // them.
  if (!ok) return new NextResponse("invalid request signature", { status: 401 });

  let payload: { type?: number; data?: { name?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }

  if (payload.type === INTERACTION_PING) return NextResponse.json(pongReply());

  if (payload.type === INTERACTION_COMMAND && payload.data?.name === "paid") {
    // Raced, not awaited. A cold Neon connection can take longer than the whole
    // interaction window; losing the number is recoverable, losing the reply
    // shows the user an error.
    const totalCents = await Promise.race([
      totalApprovedCents().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
    return NextResponse.json(messageReply(paidResponseContent(totalCents)));
  }

  // An unknown command still needs a reply, or the user is left staring at a
  // spinner until Discord times it out.
  // Ephemeral: an unknown command is useful to whoever typed it and noise to
  // everyone else in the channel.
  return NextResponse.json(messageReply("Unknown command.", { ephemeral: true }));
}
