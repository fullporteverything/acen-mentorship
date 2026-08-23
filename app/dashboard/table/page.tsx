import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import TableGame from "@/components/TableGame";

export const dynamic = "force-dynamic";

/**
 * The Table — house blackjack behind the rank pill in the top nav.
 * Play-chips only (localStorage `suite7:chips`): purely cosmetic fun, no
 * real money, no purchases, nothing server-side. The game itself is fully
 * client-side in components/TableGame.tsx; rules live in lib/blackjack.ts.
 */
export default async function TablePage() {
  await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error) ?? redirect("/"));

  return (
    <div className="scrollable" style={{ background: "#000000", position: "relative" }}>
      <TopNav active="/dashboard/table" />

      <main
        className="dash-main"
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 76,
          padding: "56px 32px 76px",
          minHeight: "calc(100vh - 76px)",
        }}
      >
        <div style={{ maxWidth: 980, margin: "0 auto", position: "relative" }}>
          {/* Card corner accent — top right: faint gold "7♣" playing-card motif */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -18,
              right: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              fontSize: 44,
              color: "rgba(231,192,113,0.07)",
              fontFamily: "Georgia, serif",
              userSelect: "none",
              lineHeight: 0.85,
            }}
          >
            <span>7</span>
            <span>♣</span>
          </div>

          {/* Header */}
          <header style={{ marginBottom: 36 }}>
            <p
              style={{
                fontSize: 10,
                letterSpacing: 4,
                color: "var(--gold)",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
                marginBottom: 10,
              }}
            >
              The Table
            </p>
            <h1
              style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: 34,
                fontWeight: 500,
                letterSpacing: 1,
                color: "var(--gold)",
                marginBottom: 10,
              }}
            >
              House Blackjack
            </h1>
            <p
              style={{
                fontSize: 11,
                fontFamily: "Georgia, serif",
                color: "rgba(245,240,240,0.5)",
                letterSpacing: 0.5,
              }}
            >
              House chips only — bragging rights, nothing more.
            </p>
          </header>

          <TableGame />
        </div>
      </main>
    </div>
  );
}
