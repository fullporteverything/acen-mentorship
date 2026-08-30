import crypto from "node:crypto";

import { formatUsd } from "./payout-parse";

/**
 * SUITE 7 — THE /paid SLASH COMMAND.
 *
 * Discord does not call a bot for slash commands; it POSTs to a URL you give
 * it. Anyone can POST to that URL, so the ONLY thing separating a real Discord
 * interaction from a forged one is the Ed25519 signature on the request. That
 * check is the whole security model of this file.
 */

/**
 * Discord hands out its public key as 32 raw bytes in hex, but node:crypto only
 * imports SPKI DER. This is the fixed DER header for an Ed25519 public key —
 * prepend it to the raw bytes and the result is a valid SPKI document.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Is this really from Discord?
 *
 * FAILS CLOSED on every error — a malformed signature, a bad key, a missing
 * header. Discord deliberately sends invalid requests when you first register
 * the endpoint and expects a 401; an endpoint that accepts them is one anyone
 * can drive.
 */
export function verifyDiscordSignature(opts: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string | undefined;
}): boolean {
  const { rawBody, signature, timestamp, publicKey } = opts;
  if (!signature || !timestamp || !publicKey) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey.trim(), "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

export const INTERACTION_PING = 1;
export const INTERACTION_COMMAND = 2;
const REPLY_PONG = 1;
const REPLY_MESSAGE = 4;
/** Only the person who ran the command sees it — so /paid can't be used to spam. */
const EPHEMERAL = 64;

/** What gets registered with Discord. */
export const PAID_COMMAND = {
  name: "paid",
  description: "What the student payout counter is",
  type: 1,
};

/**
 * The answer. Two sentences, because a slash command that returns an essay
 * gets used once.
 *
 * It carries the LIVE total rather than static copy — the number is the reason
 * anyone runs this, and an explanation that doesn't include it just sends the
 * reader back to the sidebar they were already looking at.
 */
export function paidResponseContent(totalCents: number | null): string {
  if (totalCents === null) {
    return "That channel tracks the total our students have withdrawn from their funded accounts. Every figure comes from members' own payout posts — nothing is added by hand.";
  }
  return `**${formatUsd(totalCents)}** withdrawn by Suite 7 students so far. Every figure comes from members' own payout posts in the payouts channel — nothing is added by hand.`;
}

export function pongReply() {
  return { type: REPLY_PONG };
}

export function messageReply(content: string) {
  return { type: REPLY_MESSAGE, data: { content, flags: EPHEMERAL } };
}
