import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isIdentityRequired, isNdaGateEnabled, isOnboardingRequired } from "@/lib/onboarding";

const ENV_KEYS = ["NDA_GATE_ENABLED", "STRIPE_SECRET_KEY"] as const;

describe("onboarding predicates", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is OFF by default (flag unset)", () => {
    expect(isNdaGateEnabled()).toBe(false);
    expect(isIdentityRequired()).toBe(false);
  });

  it("stays off for any value other than exactly 'true'", () => {
    for (const value of ["false", "1", "yes", "TRUE", "on", ""]) {
      process.env.NDA_GATE_ENABLED = value;
      expect(isNdaGateEnabled()).toBe(false);
    }
    process.env.NDA_GATE_ENABLED = "true";
    expect(isNdaGateEnabled()).toBe(true);
  });

  it("requires identity only when the gate is on AND Stripe is configured", () => {
    process.env.NDA_GATE_ENABLED = "true";
    expect(isIdentityRequired()).toBe(false); // no stripe key → NDA-only, no dead end
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    expect(isIdentityRequired()).toBe(true);
    // Stripe key present but gate off → still off.
    delete process.env.NDA_GATE_ENABLED;
    expect(isIdentityRequired()).toBe(false);
  });

  it("never gates admins and never gates when the flag is off", () => {
    // Flag off → nobody gated, admin or not.
    expect(isOnboardingRequired({ isAdmin: false })).toBe(false);
    expect(isOnboardingRequired({ isAdmin: true })).toBe(false);

    process.env.NDA_GATE_ENABLED = "true";
    expect(isOnboardingRequired({ isAdmin: true })).toBe(false); // admins bypass
    expect(isOnboardingRequired({ isAdmin: false })).toBe(true);
  });
});
