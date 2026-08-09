import { auth } from "@/auth";
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
  const session = await auth();
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;
  const discordId = session?.user?.discordId;
  const securityMember = discordId && !isAdmin
    ? await getSecurityMember(discordId, session?.user?.name ?? undefined)
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
