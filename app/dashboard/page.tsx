import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="scrollable" style={{ background: "#0D0505" }}>
      {/* Sidebar */}
      <aside className="sidebar">
        {/* Logo */}
        <div
          style={{
            padding: "0 28px 40px",
            borderBottom: "1px solid rgba(139,26,26,0.12)",
            marginBottom: "24px",
          }}
        >
          <p
            style={{
              fontSize: "11px",
              letterSpacing: "5px",
              color: "#8B1A1A",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            Acen
          </p>
          <p
            style={{
              fontSize: "9px",
              letterSpacing: "2px",
              color: "rgba(139,26,26,0.45)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginTop: "4px",
            }}
          >
            Mentorship
          </p>
        </div>

        {/* Nav links */}
        <nav>
          <a className="sidebar-link active" href="/dashboard">Overview</a>
          <a className="sidebar-link" href="/dashboard/lessons">Lessons</a>
          <a className="sidebar-link" href="/dashboard/resources">Resources</a>
          <a className="sidebar-link" href="/dashboard/community">Community</a>
          <a className="sidebar-link" href="/dashboard/announcements">Announcements</a>
        </nav>

        {/* User & sign out at bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "20px 28px",
            borderTop: "1px solid rgba(139,26,26,0.12)",
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
            {session.user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt="avatar"
                width={28}
                height={28}
                style={{ borderRadius: "50%", border: "1px solid rgba(139,26,26,0.35)" }}
              />
            )}
            <p
              style={{
                fontSize: "11px",
                color: "rgba(240,237,230,0.6)",
                fontFamily: "Georgia, serif",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {session.user.name}
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
                color: "rgba(139,26,26,0.55)",
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

      {/* Main content */}
      <main
        style={{
          marginLeft: "220px",
          padding: "60px 56px",
          minHeight: "100vh",
        }}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: "1px solid rgba(139,26,26,0.15)",
            paddingBottom: "32px",
            marginBottom: "48px",
          }}
        >
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "4px",
              color: "rgba(139,26,26,0.65)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: "10px",
            }}
          >
            Overview
          </p>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 400,
              letterSpacing: "4px",
              color: "#F0EDE6",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            Welcome, {session.user.name?.split(" ")[0] || "Member"}
          </h1>
        </div>

        {/* Stats cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "24px",
            marginBottom: "48px",
          }}
        >
          {[
            { label: "Lessons", value: "—", sub: "Coming soon" },
            { label: "Resources", value: "—", sub: "Coming soon" },
            { label: "Members", value: "—", sub: "Private" },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                padding: "28px 24px",
                border: "1px solid rgba(139,26,26,0.12)",
                background: "rgba(139,26,26,0.03)",
              }}
            >
              <p
                style={{
                  fontSize: "9px",
                  letterSpacing: "3px",
                  color: "rgba(139,26,26,0.6)",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                  marginBottom: "12px",
                }}
              >
                {card.label}
              </p>
              <p
                style={{
                  fontSize: "32px",
                  color: "#8B1A1A",
                  fontFamily: "Georgia, serif",
                  fontWeight: 300,
                  marginBottom: "8px",
                }}
              >
                {card.value}
              </p>
              <p
                style={{
                  fontSize: "11px",
                  color: "rgba(240,237,230,0.28)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                }}
              >
                {card.sub}
              </p>
            </div>
          ))}
        </div>

        {/* Welcome message */}
        <div
          style={{
            padding: "36px 32px",
            border: "1px solid rgba(139,26,26,0.10)",
            background: "rgba(139,26,26,0.02)",
            maxWidth: "640px",
          }}
        >
          <p
            style={{
              fontSize: "9px",
              letterSpacing: "4px",
              color: "rgba(139,26,26,0.6)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: "16px",
            }}
          >
            Announcement
          </p>
          <p
            style={{
              fontSize: "15px",
              color: "rgba(240,237,230,0.82)",
              fontFamily: "Georgia, serif",
              lineHeight: "1.9",
              fontStyle: "italic",
            }}
          >
            The platform is being built. Content, lessons, and resources will be added soon.
            Your access has been granted — stay ready.
          </p>
          <div
            style={{
              width: "32px",
              height: "1px",
              background: "linear-gradient(90deg, #8B1A1A, transparent)",
              marginTop: "24px",
            }}
          />
        </div>
      </main>
    </div>
  );
}
