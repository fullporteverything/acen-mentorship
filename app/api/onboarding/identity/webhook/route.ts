import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { constructWebhookEvent } from "@/lib/stripe-identity";
import { updateIdentityStatus } from "@/lib/onboarding-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/identity/webhook
 * Stripe calls this — it takes NO member auth and MUST NOT call allowMutation.
 * The ONLY trust boundary is the Stripe signature: the raw body is verified
 * against STRIPE_WEBHOOK_SECRET (constructWebhookEvent) and anything unverified
 * is rejected with 400.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "identity.verification_session.verified": {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      const first = session.verified_outputs?.first_name ?? "";
      const last = session.verified_outputs?.last_name ?? "";
      const verifiedName = `${first} ${last}`.trim() || undefined;
      await updateIdentityStatus(session.id, "verified", verifiedName);
      break;
    }
    case "identity.verification_session.requires_input": {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      await updateIdentityStatus(session.id, "requires_input");
      break;
    }
    case "identity.verification_session.canceled": {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      await updateIdentityStatus(session.id, "canceled");
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
