import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";

// Subtle kanji used as decorative corner/accent elements
const KANJI_ACCENTS = ["道", "剣", "心", "武", "礼", "修", "練", "気"];

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      {/* Sidebar */}
      <Sidebar active="/dashboard" />

      {/* Main content */}
      <main
        style={{
          marginLeft: "220px",
          padding: "60px 56px",
          minHeight: "100vh",
          position: "relative",
        }}
      >
        {/* Kanji corner accent — top right */}
        <div
          style={{
            position: "absolute",
            top: "24px",
            right: "40px",
            fontSize: "64px",
            color: "rgba(232,160,160,0.07)",
            fontFamily: "serif",
            userSelect: "none",
            lineHeight: 1,
          }}
        >
          武
        </div>

        {/* Header */}
        <div
          style={{
            borderBottom: "1px solid rgba(232,160,160,0.15)",
            paddingBottom: "32px",
            marginBottom: "48px",
          }}
        >
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "4px",
              color: "#E8A0A0",
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
              color: "#F5F0F0",
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
            { label: "Lessons", value: "—", sub: "Coming soon", kanji: "修" },
            { label: "Journal", value: "—", sub: "Your ledger", kanji: "念" },
            { label: "Members", value: "—", sub: "Private", kanji: "礼" },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                padding: "28px 24px",
                border: "1px solid rgba(232,160,160,0.12)",
                background: "rgba(232,160,160,0.02)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Kanji watermark */}
              <span
                style={{
                  position: "absolute",
                  bottom: "-4px",
                  right: "12px",
                  fontSize: "52px",
                  color: "rgba(232,160,160,0.06)",
                  fontFamily: "serif",
                  userSelect: "none",
                  lineHeight: 1,
                }}
              >
                {card.kanji}
              </span>
              <p
                style={{
                  fontSize: "9px",
                  letterSpacing: "3px",
                  color: "rgba(232,160,160,0.6)",
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
                  color: "#E8A0A0",
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
                  color: "rgba(245,240,240,0.28)",
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
            border: "1px solid rgba(232,160,160,0.10)",
            background: "rgba(232,160,160,0.02)",
            maxWidth: "640px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Kanji accent — announcement block */}
          <span
            style={{
              position: "absolute",
              top: "8px",
              right: "20px",
              fontSize: "48px",
              color: "rgba(232,160,160,0.06)",
              fontFamily: "serif",
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            気
          </span>
          <p
            style={{
              fontSize: "9px",
              letterSpacing: "4px",
              color: "rgba(232,160,160,0.6)",
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
              color: "rgba(245,240,240,0.82)",
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
              background: "linear-gradient(90deg, #E8A0A0, transparent)",
              marginTop: "24px",
            }}
          />
        </div>

        {/* Kanji footer accent */}
        <div
          style={{
            marginTop: "64px",
            fontSize: "13px",
            color: "rgba(232,160,160,0.18)",
            fontFamily: "serif",
            letterSpacing: "12px",
            userSelect: "none",
          }}
        >
          道剣心武礼修練気
        </div>
      </main>
    </div>
  );
}
