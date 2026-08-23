import { auth, signOut } from "@/auth";
import JournalNavBadge from "@/components/JournalNavBadge";
import ProfileTrigger from "@/components/ProfileTrigger";
import NotificationCenter from "@/components/NotificationCenter";
import OnboardingTour from "@/components/OnboardingTour";
import { getAddedLessons, getLessonOverrides, getViewerProgress } from "@/lib/lesson-store";
import { buildEffectiveLessons, computeCurriculumStates } from "@/lib/lessons-config";
import { autoPassedLessonIds } from "@/lib/progress-link";
import { deriveRank, type Rank } from "@/lib/rank";

interface TopNavProps {
  /** href of the nav link that should render as active. */
  active?: string;
}

const NAV_LINKS: { label: string; href: string }[] = [
  { label: "The Lobby", href: "/dashboard" },
  { label: "Lectures", href: "/dashboard/lessons" },
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

  // Member rank pill. Kept cheap and fully defensive: any failure just drops
  // the chip rather than breaking the nav that every dashboard page depends on.
  let rank: Rank | null = null;
  try {
    const discordId =
      session?.user?.discordId?.trim() || session?.user?.id?.trim();
    if (discordId) {
      const [progress, addedLessons, overrides] = await Promise.all([
        getViewerProgress(discordId),
        getAddedLessons(),
        getLessonOverrides(),
      ]);
      const lessons = buildEffectiveLessons(addedLessons, overrides);
      const completedLessonIds = autoPassedLessonIds(
        discordId,
        progress.completedLessons,
        lessons.map((lesson) => lesson.id)
      );
      const curriculum = computeCurriculumStates(
        completedLessonIds,
        lessons,
        isAdmin
      );
      rank = deriveRank({
        isAdmin,
        coreStates: curriculum.coreStates,
        allStates: curriculum.states,
      });
    } else if (isAdmin) {
      rank = deriveRank({ isAdmin });
    }
  } catch {
    rank = null;
  }

  return (
    <>
    <header className="topnav">
      {/* Left cluster: text wordmark — click returns to /dashboard. No icon
         chip: the wordmark is the "SUITE 7" text alone (™ lives only on the
         homepage). */}
      <a
        className="topnav-brand"
        href="/dashboard"
        aria-label="Return to the lobby"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          minWidth: 0,
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        <div
          className="topnav-brand-text"
          style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}
        >
          <span
            style={{
              fontSize: 12,
              letterSpacing: 6,
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            <span
              style={{
                background: "linear-gradient(180deg,#f7e8ac,#b8934a)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "#e3c071",
                fontVariantNumeric: "lining-nums",
              }}
            >
              SUITE 7
            </span>
          </span>
          <span
            className="topnav-brand-sub"
            style={{
              fontSize: 9,
              letterSpacing: 3,
              color: "rgba(231,192,113,0.5)",
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
        {rank && (
          // Status badge — the member's rank. Deliberately NOT button-styled
          // (transparent, thin gold rule, gold dot) so it reads as a label, not
          // a clickable control.
          <span
            className="topnav-rank"
            aria-label={`Rank: ${rank}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid rgba(231,192,113,0.35)",
              color: "#e3c071",
              fontSize: 9,
              letterSpacing: 2,
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              fontWeight: 600,
              padding: "5px 11px",
              borderRadius: 999,
              whiteSpace: "nowrap",
              lineHeight: 1,
              cursor: "default",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#e3c071",
                boxShadow: "0 0 6px rgba(231,192,113,0.6)",
              }}
            />
            {rank}
          </span>
        )}
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
              color: "rgba(231,192,113,0.6)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              background: "none",
              border: "1px solid rgba(231,192,113,0.2)",
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
