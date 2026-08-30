import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { paidResponseContent, verifyDiscordSignature } from "./discord-interactions";

/** A throwaway Ed25519 pair, standing in for Discord's. */
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  return { raw, privateKey };
}

describe("proving a request really came from Discord", () => {
  const { raw, privateKey } = keypair();
  const body = JSON.stringify({ type: 1 });
  const timestamp = "1700000000";
  const sign = (message: string) =>
    crypto.sign(null, Buffer.from(message), privateKey).toString("hex");

  it("accepts a properly signed request", () => {
    expect(
      verifyDiscordSignature({
        rawBody: body,
        signature: sign(timestamp + body),
        timestamp,
        publicKey: raw,
      })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    // The signature covers timestamp + body, so changing either must fail —
    // this endpoint is public, and the signature is the only thing standing
    // between it and anyone on the internet.
    expect(
      verifyDiscordSignature({
        rawBody: JSON.stringify({ type: 2 }),
        signature: sign(timestamp + body),
        timestamp,
        publicKey: raw,
      })
    ).toBe(false);
  });

  it("rejects a replayed timestamp", () => {
    expect(
      verifyDiscordSignature({
        rawBody: body,
        signature: sign(timestamp + body),
        timestamp: "1700009999",
        publicKey: raw,
      })
    ).toBe(false);
  });

  it("fails closed on anything malformed", () => {
    // Discord sends deliberately invalid requests when the endpoint is first
    // registered and refuses a URL that accepts them.
    const base = { rawBody: body, signature: sign(timestamp + body), timestamp, publicKey: raw };
    expect(verifyDiscordSignature({ ...base, signature: null })).toBe(false);
    expect(verifyDiscordSignature({ ...base, timestamp: null })).toBe(false);
    expect(verifyDiscordSignature({ ...base, publicKey: undefined })).toBe(false);
    expect(verifyDiscordSignature({ ...base, publicKey: "not-hex" })).toBe(false);
    expect(verifyDiscordSignature({ ...base, signature: "zz" })).toBe(false);
    expect(verifyDiscordSignature({ ...base, publicKey: "ab".repeat(32) })).toBe(false);
  });
});

describe("what /paid says", () => {
  it("leads with the live figure", () => {
    // The number is the reason anyone runs this. An explanation without it
    // just sends the reader back to the sidebar they were already looking at.
    const text = paidResponseContent(4_579_948);
    expect(text).toContain("$45,799");
    expect(text.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
  });

  it("still explains itself when the total can't be read in time", () => {
    const text = paidResponseContent(null);
    expect(text).not.toContain("$");
    expect(text.length).toBeGreaterThan(40);
  });
});
