import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import { redirect } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import TableGame from "@/components/TableGame";

export const dynamic = "force-dynamic";

/**
 * The Table — house blackjack behind the rank pill in the top nav.
 *
 * This route has no page chrome on purpose: no heading, no bordered panel, no
 * side column. Below the TopNav the game OWNS the viewport — the 3D stage runs
 * full-bleed on black and every control floats over it as a HUD (see
 * components/TableGame.tsx and app/globals.css `.suite7-stage*`). The only bit
 * of page left is a hairline back-link, so a member is never trapped in it.
 *
 * The bankroll is server-held (lib/table-chips-*); play chips only, no
 * purchases, no cash-out. Rules live in lib/blackjack.ts.
 */
export default async function TablePage() {
  await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error) ?? redirect("/"));

  return (
    <div style={{ background: "#000000", position: "relative", minHeight: "100dvh" }}>
      <TopNav active="/dashboard/table" />

      <main className="suite7-stage-main">
        <Link href="/dashboard" className="suite7-backlink">
          ← Back
        </Link>
        <TableGame />
      </main>
    </div>
  );
}
