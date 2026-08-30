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
