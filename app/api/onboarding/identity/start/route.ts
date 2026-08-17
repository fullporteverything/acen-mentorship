import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createIdentityVerificationSession } from "@/lib/stripe-identity";
import { createIdentitySessionRecord } from "@/lib/onboarding-store";

export const dynamic = "force-dynamic";

/** Public origin of the request, honoring the reverse proxy's forwarded headers. */
function requestOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

/**
 * POST /api/onboarding/identity/start
 * Creates a hosted Stripe Identity verification session and returns its redirect
 * URL. Returns 400 when Stripe isn't configured (so a half-enabled gate never
 * dead-ends — the layout treats identity as not-required in that case anyway).
 */
export async function POST(req: Request) {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;
  const denied = await allowMutation(member, "onboarding.identity-start", req);
  if (denied) return denied;
  const rate = await consumeRateLimit(member.discordId, "onboarding.identity-start", {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "identity verification not configured" }, { status: 400 });
  }

  const session = await createIdentityVerificationSession({
    returnUrl: `${requestOrigin(req)}/onboarding`,
    metadata: { discordId: member.discordId },
  });

  await createIdentitySessionRecord(member.discordId, member.name, session.id);

  return NextResponse.json({ url: session.url });
}
