import { auth, signOut } from "@/auth";

interface SidebarProps {
  /** href of the nav link that should render as active. */
  active?: string;
}

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Lessons", href: "/dashboard/lessons" },
  { label: "Resources", href: "/dashboard/resources" },
  { label: "Community", href: "/dashboard/community" },
  { label: "Announcements", href: "/dashboard/announcements" },
];

/**
 * Shared dashboard sidebar. Server component so it can read the session and
 * conditionally surface the Admin link only for the configured admin Discord
 * id. Styling mirrors the original inline sidebar in dashboard/page.tsx.
 */
export default async function Sidebar({ active = "/dashboard" }: SidebarProps) {
  const session = await auth();
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;

  const links = [...NAV_LINKS];
  if (isAdmin) {
    links.push({ label: "Admin", href: "/dashboard/admin" });
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div
        style={{
          padding: "0 28px 40px",
          borderBottom: "1px solid rgba(232,160,160,0.12)",
          marginBottom: "24px",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            letterSpacing: "5px",
            color: "#E8A0A0",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
          }}
        >
          Dojo
        </p>
        <p
          style={{
            fontSize: "9px",
            letterSpacing: "2px",
            color: "rgba(232,160,160,0.45)",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            marginTop: "4px",
          }}
        >
          Mentorship
        </p>
      </div>

      {/* Kanji accent — sidebar decoration */}
      <div
        style={{
          padding: "0 28px 20px",
          fontSize: "22px",
          color: "rgba(232,160,160,0.12)",
          fontFamily: "serif",
          letterSpacing: "8px",
          userSelect: "none",
        }}
      >
        道剣心
      </div>

      {/* Nav links */}
      <nav>
        {links.map((link) => (
          <a
            key={link.href}
            className={`sidebar-link${active === link.href ? " active" : ""}`}
            href={link.href}
          >
            {link.label}
          </a>
        ))}
      </nav>

      {/* User & sign out at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "20px 28px",
          borderTop: "1px solid rgba(232,160,160,0.12)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "14px",
          }}
        >
          {session?.user?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt="avatar"
              width={28}
              height={28}
              style={{
                borderRadius: "50%",
                border: "1px solid rgba(232,160,160,0.35)",
              }}
            />
          )}
          <p
            style={{
              fontSize: "11px",
              color: "rgba(245,240,240,0.6)",
              fontFamily: "Georgia, serif",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {session?.user?.name}
          </p>
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            style={{
              fontSize: "9px",
              letterSpacing: "3px",
              color: "rgba(232,160,160,0.55)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              transition: "color 0.2s",
            }}
          >
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  );
}
