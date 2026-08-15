import { auth, signOut } from "@/auth";
import PhiLogo from "@/components/PhiLogo";
import JournalNavBadge from "@/components/JournalNavBadge";
import ProfileTrigger from "@/components/ProfileTrigger";
import NotificationCenter from "@/components/NotificationCenter";
import OnboardingTour from "@/components/OnboardingTour";

interface TopNavProps {
  /** href of the nav link that should render as active. */
  active?: string;
}

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Lessons", href: "/dashboard/lessons" },
  { label: "Journal", href: "/dashboard/journal" },
  { label: "Homework", href: "/dashboard/homework" },
];

/**
 * Horizontal top navigation. Server component so it can read the session and
 * conditionally surface the Admin link. Replaces the previous fixed left
 * sidebar; every /dashboard page reserves vertical space for it via the
 * `.topnav` height in globals.css.
 *
 * Phone tier (≤560px): the bar keeps its 76px height — pages hard-code a
 * matching 76px top margin — but reflows into two rows via CSS grid, brand +
 * actions above, the nav links across the full width below. See the
 * `.topnav-*` phone block in globals.css; every class hook the media query
 * needs is attached here.
 */
export default async function TopNav({ active = "/dashboard" }: TopNavProps) {
  const session = await auth();
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;

  const links = [...NAV_LINKS];
  if (isAdmin) {
    links.push({ label: "Admin", href: "/dashboard/admin" });
  }

  return (
    <>
    <header className="topnav">
      {/* Left cluster: Phi mark + wordmark — click returns to /dashboard */}
      <a
        className="topnav-brand"
        href="/dashboard"
        aria-label="Return to overview"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          minWidth: 0,
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        {/* PhiLogo takes a numeric size and this is a server component, so the
           phone shrink happens in CSS: the wrapper clamps the box, the inner
           mark is scaled to match. */}
        <div className="topnav-logo">
          <PhiLogo size={52} />
        </div>
        <div
          className="topnav-brand-text"
          style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}
        >
          <span
            style={{
              fontSize: 12,
              letterSpacing: 6,
              color: "#E8A0A0",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            Dojo
          </span>
          <span
            className="topnav-brand-sub"
            style={{
              fontSize: 9,
              letterSpacing: 3,
              color: "rgba(232,160,160,0.5)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginTop: 3,
            }}
          >
            Mentorship
          </span>
        </div>
      </a>

      {/* Center cluster: nav links */}
      <nav className="topnav-links">
        {links.map((link) => (
          <a
            key={link.href}
            className={`topnav-link${active === link.href ? " active" : ""}`}
            href={link.href}
          >
            {link.label}
            {link.href === "/dashboard/journal" ? <JournalNavBadge /> : null}
          </a>
        ))}
      </nav>

      {/* Right cluster: user + sign out */}
      <div
        className="topnav-actions"
        style={{ display: "flex", alignItems: "center", gap: 14 }}
      >
        <NotificationCenter />
        <ProfileTrigger
          discordId={session?.user?.discordId}
          name={session?.user?.name ?? undefined}
          image={session?.user?.image ?? undefined}
          avatarHash={session?.user?.avatarHash}
          bannerHash={session?.user?.bannerHash}
          accentColor={session?.user?.accentColor}
          decorationAsset={session?.user?.decorationAsset}
        />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="topnav-signout"
            style={{
              fontSize: 9,
              letterSpacing: 3,
              color: "rgba(232,160,160,0.6)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              background: "none",
              border: "1px solid rgba(232,160,160,0.2)",
              cursor: "pointer",
              padding: "8px 14px",
              transition: "color 0.2s, border-color 0.2s",
            }}
          >
            Sign Out
          </button>
        </form>
      </div>
    </header>

    {/* First-visit tour. Lives outside <header> on purpose: the topnav's
       backdrop-filter makes it a containing block, which would trap the
       overlay's fixed positioning inside the 76px strip. */}
    <OnboardingTour />
    </>
  );
}
