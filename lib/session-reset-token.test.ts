import { describe, expect, it } from "vitest";

import { mintResetToken, verifyResetToken } from "./session-reset-token";

const SECRET = "test-secret-do-not-use-in-production";
const OTHER_SECRET = "a-different-secret-entirely";
const DISCORD_ID = "123456789012345678";
const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const FIVE_MINUTES = 5 * 60 * 1000;

describe("minting", () => {
  it("issues a token for a valid account", async () => {
    const token = await mintResetToken(DISCORD_ID, SECRET, NOW);

    expect(token).toBeTruthy();
    expect(await verifyResetToken(token!, SECRET, NOW)).toEqual({
      ok: true,
      discordId: DISCORD_ID,
    });
  });

  it("refuses to mint without a secret — no secret means no way to verify", async () => {
    expect(await mintResetToken(DISCORD_ID, undefined, NOW)).toBeNull();
    expect(await mintResetToken(DISCORD_ID, "", NOW)).toBeNull();
  });

  it("refuses to mint for anything that is not a snowflake", async () => {
    for (const bad of ["", "abc", "12345", "'; DROP TABLE members;--", "1".repeat(40)]) {
      expect(await mintResetToken(bad, SECRET, NOW)).toBeNull();
    }
  });
});

describe("verification — the cases that decide whether this is safe", () => {
  it("rejects a token signed with a different secret", async () => {
    // The whole security property: without AUTH_SECRET you cannot mint one.
    const forged = await mintResetToken(DISCORD_ID, OTHER_SECRET, NOW);

    expect(await verifyResetToken(forged!, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a token whose ACCOUNT has been swapped", async () => {
    // The attack that matters: take your own valid token, edit the payload to
    // someone else's id, and clear their sessions instead.
    const token = await mintResetToken(DISCORD_ID, SECRET, NOW);
    const [payload, signature] = token!.split(".");
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const swapped = decoded.replace(DISCORD_ID, "876543210987654321");
    const repacked = btoa(swapped)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyResetToken(`${repacked}.${signature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a token whose EXPIRY has been pushed out", async () => {
    const token = await mintResetToken(DISCORD_ID, SECRET, NOW);
    const [payload, signature] = token!.split(".");
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const extended = decoded.replace(
      String(NOW + FIVE_MINUTES),
      String(NOW + 10 * 365 * 24 * 60 * 60 * 1000)
    );
    const repacked = btoa(extended)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyResetToken(`${repacked}.${signature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("expires after five minutes", async () => {
    const token = await mintResetToken(DISCORD_ID, SECRET, NOW);

    // Still good a second before.
    expect(await verifyResetToken(token!, SECRET, NOW + FIVE_MINUTES - 1000)).toEqual({
      ok: true,
      discordId: DISCORD_ID,
    });
    // Dead exactly on the boundary, and after.
    expect(await verifyResetToken(token!, SECRET, NOW + FIVE_MINUTES)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await verifyResetToken(token!, SECRET, NOW + FIVE_MINUTES * 10)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects malformed input without throwing", async () => {
    const junk = [
      "",
      ".",
      "..",
      "not-a-token",
      "a.b.c",
      "!!!.???",
      "x".repeat(600),
      // A payload that decodes but carries the wrong version.
      `${btoa("v0.123456789012345678.99999999999999")}.sig`,
    ];

    for (const token of junk) {
      const result = await verifyResetToken(token, SECRET, NOW);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects everything when no secret is configured", async () => {
    const token = await mintResetToken(DISCORD_ID, SECRET, NOW);

    expect(await verifyResetToken(token!, undefined, NOW)).toEqual({
      ok: false,
      reason: "unconfigured",
    });
  });

  it("a token for one account never authorises another", async () => {
    const mine = await mintResetToken(DISCORD_ID, SECRET, NOW);
    const theirs = await mintResetToken("876543210987654321", SECRET, NOW);

    const a = await verifyResetToken(mine!, SECRET, NOW);
    const b = await verifyResetToken(theirs!, SECRET, NOW);

    expect(a).toEqual({ ok: true, discordId: DISCORD_ID });
    expect(b).toEqual({ ok: true, discordId: "876543210987654321" });
    expect(mine).not.toEqual(theirs);
  });
});

describe("isolation — a student can never reach another student's sessions", () => {
  /**
   * The endpoint takes the account to clear from INSIDE the verified token and
   * never from the request, so these are the only ways a caller could try to
   * point it at somebody else. All of them have to fail.
   */
  const VICTIM = "999888777666555444";

  it("cannot mint a token for an account you have not authenticated as", async () => {
    // Minting happens only inside the sign-in callback, after Discord has
    // authenticated the caller for that id. Without AUTH_SECRET there is no
    // way to produce one out of band.
    const forged = await mintResetToken(VICTIM, "guessed-secret", NOW);

    expect(await verifyResetToken(forged!, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("cannot re-point a valid token at another account", async () => {
    const mine = await mintResetToken(DISCORD_ID, SECRET, NOW);
    const [payload, signature] = mine!.split(".");
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const repointed = btoa(decoded.replace(DISCORD_ID, VICTIM))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await verifyResetToken(`${repointed}.${signature}`, SECRET, NOW);

    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ discordId: VICTIM });
  });

  it("cannot splice another account's payload onto a signature you hold", async () => {
    const mine = await mintResetToken(DISCORD_ID, SECRET, NOW);
    const theirs = await mintResetToken(VICTIM, SECRET, NOW);
    const mySignature = mine!.split(".")[1];
    const theirPayload = theirs!.split(".")[0];

    expect(await verifyResetToken(`${theirPayload}.${mySignature}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("a verified token always reports the account it was minted for, and only that one", async () => {
    const mine = await mintResetToken(DISCORD_ID, SECRET, NOW);

    const result = await verifyResetToken(mine!, SECRET, NOW);

    expect(result).toEqual({ ok: true, discordId: DISCORD_ID });
    // Nothing in the token or its verification can widen the blast radius:
    // the endpoint revokes exactly this id.
    expect(result.ok && result.discordId).not.toBe(VICTIM);
  });
});
