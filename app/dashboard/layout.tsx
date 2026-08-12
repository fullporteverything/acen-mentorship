import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import VpnGuard from "@/components/VpnGuard";
import ScreenGuard from "@/components/ScreenGuard";
import SiteMeditation from "@/components/SiteMeditation";
import { getSecurityMember } from "@/lib/security-store";

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
      </ScreenGuard>
    </VpnGuard>
  );
}
