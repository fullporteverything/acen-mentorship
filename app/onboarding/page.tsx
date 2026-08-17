import { redirect } from "next/navigation";

import { requireMember } from "@/lib/authz";
import { isIdentityRequired, isNdaGateEnabled } from "@/lib/onboarding";
import { getOnboardingStatus } from "@/lib/onboarding-store";
import { NDA_OPERATOR, NDA_TEXT } from "@/lib/nda";
import OnboardingFlow from "@/components/OnboardingFlow";

export const dynamic = "force-dynamic";

/**
 * The onboarding gate's landing page. Requires auth (any member). If the gate is
 * off — or the member is an admin, or already fully onboarded — there is nothing
 * to do here, so we send them straight to /dashboard. Otherwise we render the
 * two-step NDA + identity flow, seeded with the member's current server-side
 * status (this is also where Stripe's hosted flow returns to).
 */
export default async function OnboardingPage() {
  const identity = await requireMember().catch(() => null);
  if (!identity) redirect("/");

  // Gate off or admin → the dashboard never gates them, so neither do we.
  if (!isNdaGateEnabled() || identity.isAdmin) redirect("/dashboard");

  const identityRequired = isIdentityRequired();
  const status = await getOnboardingStatus(identity.discordId);

  // Already satisfied every required step → into the dojo.
  if (status.ndaSignedCurrent && (!identityRequired || status.identityVerified)) {
    redirect("/dashboard");
  }

  return (
    <OnboardingFlow
      operator={NDA_OPERATOR}
      ndaText={NDA_TEXT}
      ndaSignedCurrent={status.ndaSignedCurrent}
      identityRequired={identityRequired}
      identityStatus={status.identityStatus}
    />
  );
}
