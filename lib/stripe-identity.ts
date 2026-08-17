import "server-only";

import Stripe from "stripe";

/**
 * Lazily constructed Stripe client. Never instantiated at module load so that
 * importing this file (e.g. from a route that then decides Stripe isn't
 * configured) is free and safe when STRIPE_SECRET_KEY is absent. Use TEST-mode
 * keys (sk_test_…) in non-production.
 */
let client: Stripe | undefined;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

/**
 * Creates a HOSTED Stripe Identity verification session and returns its
 * redirect `url`. We use the hosted redirect flow (not client-side Stripe.js /
 * the embedded modal) specifically so no new script origins are needed and the
 * site's CSP stays untouched.
 */
export async function createIdentityVerificationSession(input: {
  returnUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const session = await getStripe().identity.verificationSessions.create({
    type: "document",
    return_url: input.returnUrl,
    metadata: input.metadata,
  });
  if (!session.url) {
    throw new Error("Stripe did not return a hosted verification URL");
  }
  return { id: session.id, url: session.url };
}

/**
 * Verifies a webhook payload against STRIPE_WEBHOOK_SECRET and returns the
 * decoded event. Throws when the signature is missing/invalid or the secret is
 * unset — callers translate that into a 400 so unverified traffic is rejected.
 */
export function constructWebhookEvent(rawBody: string, signatureHeader: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  if (!signatureHeader) {
    throw new Error("Missing stripe-signature header");
  }
  return getStripe().webhooks.constructEvent(rawBody, signatureHeader, secret);
}
