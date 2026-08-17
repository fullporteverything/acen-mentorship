import type { MemberIdentity } from "@/lib/authz";

/**
 * The onboarding gate (NDA e-signature + Stripe Identity) is OFF unless this
 * flag is exactly "true". Any other value — unset, "false", "1", "yes" — leaves
 * /dashboard behaving exactly as it did before the gate existed. This is the
 * single kill-switch that guarantees the gate can never lock anyone out until
 * the owner deliberately turns it on.
 */
export function isNdaGateEnabled(): boolean {
  return process.env.NDA_GATE_ENABLED === "true";
}

/**
 * Stripe Identity is required ONLY when the gate is on AND a Stripe secret key
 * is configured. Enabling the gate before wiring Stripe still lets members
 * through after they sign the NDA — no dead end from a half-finished config.
 */
export function isIdentityRequired(): boolean {
  return isNdaGateEnabled() && Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Whether this identity must be routed through the onboarding flow at all.
 * Admins are NEVER gated (the owner must not be able to lock themselves out),
 * and nobody is gated while the flag is off. Kept pure so it can be unit-tested
 * without a session or a database.
 */
export function isOnboardingRequired(identity: Pick<MemberIdentity, "isAdmin">): boolean {
  if (!isNdaGateEnabled()) return false;
  if (identity.isAdmin) return false;
  return true;
}
