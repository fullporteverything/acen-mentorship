import { auth } from "@/auth";
import VpnGuard from "@/components/VpnGuard";
import ScreenGuard from "@/components/ScreenGuard";
import SiteMeditation from "@/components/SiteMeditation";

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

  return (
    <VpnGuard>
      <ScreenGuard
        discordId={session?.user?.discordId}
        discordUsername={session?.user?.name ?? undefined}
        isAdmin={isAdmin}
      >
        {children}
        <SiteMeditation />
      </ScreenGuard>
    </VpnGuard>
  );
}
