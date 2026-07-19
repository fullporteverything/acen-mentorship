import { auth, signOut } from "@/auth";
import PhiLogo from "@/components/PhiLogo";

interface TopNavProps {
  /** href of the nav link that should render as active. */
  active?: string;
}

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Lessons", href: "/dashboard/lessons" },
  { label: "Journal", href: "/dashboard/journal" },
  { label: "Announcements", href: "/dashboard/announcements" },
];

/**
 * Horizontal top navigation. Server component so it can read the session and
 * conditionally surface the Admin link. Replaces the previous fixed left
 * sidebar; every /dashboard page reserves vertical space for it via the
 * `.topnav` height in globals.css.
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
    <header className="topnav">
      {/* Left cluster: Phi mark + wordmark — click returns to /dashboard */}
      <a
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
        <PhiLogo size={52} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
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
          </a>
        ))}
      </nav>

      {/* Right cluster: user + sign out */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {session?.user?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt="avatar"
            width={30}
            height={30}
            style={{
              borderRadius: "50%",
              border: "1px solid rgba(232,160,160,0.35)",
            }}
          />
        )}
        <span
          className="topnav-username"
          style={{
            fontSize: 11,
            color: "rgba(245,240,240,0.65)",
            fontFamily: "Georgia, serif",
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {session?.user?.name}
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
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
  );
}
