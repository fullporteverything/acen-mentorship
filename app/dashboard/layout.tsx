import { redirect } from "next/navigation";
import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import VpnGuard from "@/components/VpnGuard";
import ScreenGuard from "@/components/ScreenGuard";
import SiteMeditation from "@/components/SiteMeditation";
import SiteTerminal from "@/components/SiteTerminal";
import { getSecurityMember } from "@/lib/security-store";
import { isIdentityRequired, isNdaGateEnabled } from "@/lib/onboarding";
import { getOnboardingStatus } from "@/lib/onboarding-store";

/**
 * Wraps every /dashboard route with the security guards:
 *   VpnGuard  — blocks VPN/proxy/datacenter IPs
 *   ScreenGuard — deters + logs screen-recording attempts, tagged to the member
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error));
  const isAdmin = identity?.isAdmin ?? false;
  const discordId = identity?.discordId;

  // Onboarding gate. OFF by default: when NDA_GATE_ENABLED !== "true" this is a
  // single env read and nothing else changes. Admins are never gated. The NDA
  // step is always required once enabled; the identity step only when Stripe is
  // configured — so enabling the flag before wiring Stripe is not a dead end.
  if (isNdaGateEnabled() && identity && !isAdmin) {
    const status = await getOnboardingStatus(identity.discordId);
    if (!status.ndaSignedCurrent) redirect("/onboarding");
    if (isIdentityRequired() && !status.identityVerified) redirect("/onboarding");
  }
  const securityMember = discordId && !isAdmin
    ? await getSecurityMember(discordId, identity?.name ?? undefined)
    : null;

  return (
    <VpnGuard>
      <ScreenGuard
        isAdmin={isAdmin}
        initialStrikes={securityMember?.strikes}
        initialAcknowledgedStrikes={securityMember?.acknowledgedStrikes}
        initialLocked={securityMember?.locked}
      >
        {children}
        <SiteMeditation />
        {/* SUITE 7 — CONSOLE. Mounted ONLY for administrators, and that
           decision is made HERE, on the server, from the session +
           ADMIN_DISCORD_ID. A member never receives the element, the
           keystroke listener, or any response to the passphrase — which is a
           convenience step, not a security boundary. See the security note at
           the top of components/SiteTerminal.tsx. */}
        {isAdmin ? <SiteTerminal isAdmin /> : null}
      </ScreenGuard>
    </VpnGuard>
  );
}
