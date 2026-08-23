import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import AdminPanel from "@/components/AdminPanel";

export default async function AdminPage() {
  const identity = await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error) ?? redirect("/"));
  const isAdmin = identity.isAdmin;

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      <TopNav active="/dashboard/admin" />

      <main
        style={{
          marginTop: "76px",
          padding: "60px 56px",
          minHeight: "calc(100vh - 76px)",
          position: "relative",
          maxWidth: "980px",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {/* Card-suit corner accent — top right */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "24px",
            right: "40px",
            fontSize: "64px",
            color: "rgba(231,192,113,0.07)",
            fontFamily: "serif",
            userSelect: "none",
            lineHeight: 1,
          }}
        >
          ♠
        </div>

        {/* Header */}
        <div
          style={{
            borderBottom: "1px solid rgba(231,192,113,0.15)",
            paddingBottom: "32px",
            marginBottom: "48px",
          }}
        >
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "4px",
              color: "#e3c071",
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
              color: "#F5F0F0",
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
              border: "1px solid rgba(231,192,113,0.15)",
              background: "rgba(231,192,113,0.02)",
              maxWidth: "480px",
            }}
          >
            <p
              style={{
                fontSize: "44px",
                color: "#e3c071",
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
                color: "rgba(245,240,240,0.55)",
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
