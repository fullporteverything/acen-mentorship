import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import AdminPanel from "@/components/AdminPanel";

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session.user.discordId === process.env.ADMIN_DISCORD_ID;

  return (
    <div className="scrollable" style={{ background: "#EADAC0" }}>
      <Sidebar active="/dashboard/admin" />

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
            color: "rgba(196,24,24,0.07)",
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
            borderBottom: "1px solid rgba(196,24,24,0.15)",
            paddingBottom: "32px",
            marginBottom: "48px",
          }}
        >
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "4px",
              color: "#C41818",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: "10px",
            }}
          >
            Admin
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
            Control Room
          </h1>
        </div>

        {isAdmin ? (
          <AdminPanel />
        ) : (
          <div
            style={{
              padding: "48px 40px",
              border: "1px solid rgba(196,24,24,0.15)",
              background: "rgba(196,24,24,0.02)",
              maxWidth: "480px",
            }}
          >
            <p
              style={{
                fontSize: "44px",
                color: "#C41818",
                fontFamily: "Georgia, serif",
                fontWeight: 300,
                marginBottom: "12px",
              }}
            >
              403
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "rgba(240,237,230,0.55)",
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                lineHeight: 1.8,
              }}
            >
              You do not have permission to view this page.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
