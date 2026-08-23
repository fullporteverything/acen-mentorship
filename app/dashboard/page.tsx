import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import { redirect } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import AnnouncementsFeed from "@/components/AnnouncementsFeed";
import {
  getAddedLessons,
  getAnnouncements,
  getLessonOverrides,
  getSeenAnnouncements,
  getViewerProgress,
} from "@/lib/lesson-store";
import { getJournal } from "@/lib/journal-store";
import { getSecurityMember } from "@/lib/security-store";
import { autoPassedLessonIds, progressViewerIds } from "@/lib/progress-link";
import {
  buildEffectiveLessons,
  computeCurriculumStates,
  isCoreLesson,
  sectionLessonNumber,
} from "@/lib/lessons-config";
import {
  buildCoreLearningSummary,
  buildOverviewStats,
  countPendingHomework,
} from "@/lib/overview-stats";
import SupportLink from "@/components/SupportLink";
import MyHomeworkCard from "@/components/MyHomeworkCard";
import { listHomeworkArchive } from "@/lib/homework-archive";

export const dynamic = "force-dynamic";

// Subtle card-suit motifs used as decorative corner/accent elements
const KANJI_ACCENTS = ["♠", "♥", "♦", "♣", "♠", "♥", "♦", "♣"];

// Where each overview stat card sends you when tapped.
const STAT_CARD_HREFS: Record<string, string> = {
  Lectures: "/dashboard/lessons",
  Journal: "/dashboard/journal",
  Homework: "/dashboard/homework",
};

export default async function DashboardPage() {
  const identity = await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error) ?? redirect("/"));
  const discordId = identity.discordId;
  const [announcements, seen, progress, addedLessons, overrides, journal, securityMember, homeworkArchive] =
    await Promise.all([
    getAnnouncements(),
    getSeenAnnouncements(discordId),
    getViewerProgress(discordId),
    getAddedLessons(),
    getLessonOverrides(),
    getJournal(discordId),
    getSecurityMember(discordId, identity.name ?? undefined),
    listHomeworkArchive({ discordIds: progressViewerIds(discordId), limit: 3 })
      .then((page) => ({ page, error: false }))
      .catch(() => ({ page: { items: [], nextCursor: null, total: 0, lessons: [] }, error: true })),
  ]);
  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const completedLessonIds = autoPassedLessonIds(
    discordId,
    progress.completedLessons,
    lessons.map((lesson) => lesson.id)
  );
  const coreProgress = buildCoreLearningSummary(
    lessons,
    completedLessonIds
  );
  const overviewStats = buildOverviewStats({
    totalLessons: coreProgress.totalLessons,
    completedLessons: coreProgress.completedLessons,
    journalEntries: journal.length,
    pendingHomework: countPendingHomework(progress.submissions),
  });

  // Floors preview: the member's current floor plus the next one or two (or the
  // first three when everything is cleared). Built the same way the Floors page
  // derives its curriculum states.
  const curriculum = computeCurriculumStates(
    completedLessonIds,
    lessons,
    identity.isAdmin
  );
  const currentIndex = curriculum.states.findIndex((state) => state.current);
  const floorsPreview =
    currentIndex === -1
      ? curriculum.states.slice(0, 3)
      : curriculum.states.slice(currentIndex, currentIndex + 3);
  const FLOOR_SUITS = ["♠", "♥", "♦", "♣"];

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      {/* Top nav */}
      <TopNav active="/dashboard" />

      {/* Main content */}
      <main
        className="overview-page"
        style={{
          marginTop: "76px",
          padding: "60px 56px",
          minHeight: "calc(100vh - 76px)",
          position: "relative",
        }}
      >
        {/* Card corner accent — top right: faint gold "7♥" playing-card motif */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: "24px",
            right: "40px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontSize: "44px",
            color: "rgba(231,192,113,0.07)",
            fontFamily: "Georgia, serif",
            userSelect: "none",
            lineHeight: 0.85,
          }}
        >
          <span>7</span>
          <span>♥</span>
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
              color: "var(--gold)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: "10px",
            }}
          >
            The Lobby
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
            Welcome, {identity.name?.split(" ")[0] || "Member"}
          </h1>
          <p
            style={{
              marginTop: "14px",
              maxWidth: "52ch",
              fontSize: "15px",
              lineHeight: 1.7,
              color: "rgba(245,240,240,0.55)",
              fontFamily: "Georgia, serif",
            }}
          >
            You&apos;re checked in — pick up where you left off, or see what the
            House is calling.
          </p>
        </div>

        {securityMember.strikes > 0 && securityMember.strikes < 3 && (
          <div className="overview-strike-notice" role="status">
            <span>Security notice</span>
            <p>
              Your account has {securityMember.strikes} of 3 screen-sharing strikes.
              A third attempt will revoke access.
            </p>
          </div>
        )}

        {/* House Calls — promoted just below the hero. Renders only when there
           is something to announce so the lobby doesn't lead with an empty
           heading. */}
        {announcements.length > 0 && (
          <div style={{ marginBottom: "48px" }}>
            <AnnouncementsFeed items={announcements} initialSeen={seen} />
          </div>
        )}

        {/* Stats cards */}
        <div className="overview-stats-grid">
          {overviewStats.map((card) => {
            const href = STAT_CARD_HREFS[card.label] ?? "/dashboard";
            return (
            <Link
              key={card.label}
              href={href}
              className="overview-stat-card"
              style={{
                padding: "28px 24px",
                border: "1px solid rgba(231,192,113,0.12)",
                background: "rgba(231,192,113,0.02)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Card-suit watermark */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  bottom: "-4px",
                  right: "12px",
                  fontSize: "52px",
                  color: "rgba(231,192,113,0.06)",
                  fontFamily: "serif",
                  userSelect: "none",
                  lineHeight: 1,
                }}
              >
                {card.kanji}
              </span>
              <p
                style={{
                  fontSize: "10px",
                  letterSpacing: "3px",
                  color: "var(--gold)",
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
                  color: "#e3c071",
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
                  color: "rgba(245,240,240,0.5)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                }}
              >
                {card.sub}
              </p>
            </Link>
          )})}
        </div>

        <section className="overview-progress-card" aria-label="Core learning progress">
          <div className="overview-progress-copy">
            <p className="overview-progress-kicker">Core progress</p>
            <h2>
              {coreProgress.nextLesson
                ? "Continue your training"
                : coreProgress.totalLessons > 0
                  ? "Core training complete"
                  : "Core training coming soon"}
            </h2>
            <p>
              {coreProgress.nextLesson
                ? coreProgress.nextLesson.title
                : `${coreProgress.completedLessons} of ${coreProgress.totalLessons} core lectures complete`}
            </p>
          </div>
          <div className="overview-progress-action">
            <div className="overview-progress-value">{coreProgress.percent}%</div>
            <div
              className="overview-progress-track"
              role="progressbar"
              aria-label="Core lectures completed"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={coreProgress.percent}
            >
              <span style={{ width: `${coreProgress.percent}%` }} />
            </div>
            <Link
              className="overview-continue-link"
              href={
                coreProgress.nextLesson
                  ? `/dashboard/lessons/${coreProgress.nextLesson.id}`
                  : "/dashboard/lessons"
              }
            >
              {coreProgress.nextLesson ? "Continue learning" : "View lectures"} →
            </Link>
          </div>
        </section>

        {/* The Floors — a card preview of the member's current + upcoming
           floors. Distinct from the CORE PROGRESS bar above it. */}
        {floorsPreview.length > 0 && (
          <section aria-label="Lectures" style={{ marginBottom: "48px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "16px",
                marginBottom: "16px",
              }}
            >
              <p
                style={{
                  fontSize: "9px",
                  letterSpacing: "4px",
                  color: "rgba(231,192,113,0.6)",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                }}
              >
                Lectures
              </p>
              <Link
                href="/dashboard/lessons"
                style={{
                  fontSize: "10px",
                  letterSpacing: "2px",
                  color: "var(--gold)",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                See all lectures →
              </Link>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "16px",
              }}
            >
              {floorsPreview.map((s, i) => {
                const locked = !s.unlocked;
                return (
                  <Link
                    key={s.lesson.id}
                    href={`/dashboard/lessons/${s.lesson.id}`}
                    style={{
                      display: "block",
                      position: "relative",
                      overflow: "hidden",
                      padding: "20px 22px",
                      border: s.current
                        ? "1px solid rgba(231,192,113,0.35)"
                        : "1px solid rgba(231,192,113,0.12)",
                      background: "rgba(231,192,113,0.02)",
                      textDecoration: "none",
                      opacity: locked ? 0.5 : 1,
                    }}
                  >
                    {/* Faint gold suit accent — rotates ♠♥♦♣ down the preview. */}
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        bottom: "-4px",
                        right: "12px",
                        fontSize: "52px",
                        color: "rgba(231,192,113,0.06)",
                        fontFamily: "serif",
                        userSelect: "none",
                        lineHeight: 1,
                      }}
                    >
                      {FLOOR_SUITS[i % FLOOR_SUITS.length]}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "10px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "9px",
                          letterSpacing: "3px",
                          color: "var(--gold)",
                          textTransform: "uppercase",
                          fontFamily: "Georgia, serif",
                        }}
                      >
                        {isCoreLesson(s.lesson) ? "Core" : s.lesson.group} · Lecture{" "}
                        {String(
                          sectionLessonNumber(s.lesson.id, lessons)
                        ).padStart(2, "0")}
                      </span>
                      <span
                        className={`lesson-card-status ${s.unlocked && s.completed ? "completed" : ""}`}
                        aria-label={
                          locked
                            ? "Locked"
                            : s.completed
                              ? "Cleared"
                              : s.current
                                ? "Current lecture"
                                : undefined
                        }
                        title={s.completed ? "Cleared" : undefined}
                      >
                        {locked ? "🔒" : s.completed ? "✓" : s.current ? "→" : ""}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: "15px",
                        color: "#F5F0F0",
                        fontFamily: "Georgia, serif",
                        letterSpacing: "1px",
                        marginBottom: "6px",
                      }}
                    >
                      {s.lesson.title}
                    </p>
                    <p
                      style={{
                        fontSize: "12px",
                        color: "rgba(245,240,240,0.55)",
                        fontFamily: "Georgia, serif",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {s.lesson.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <MyHomeworkCard items={homeworkArchive.page.items} error={homeworkArchive.error} />

        <footer className="dashboard-footer">
        <SupportLink>Support and access appeals</SupportLink>
        {/* Card-suit footer accent */}
        <div
          aria-hidden
          style={{
            marginTop: "64px",
            fontSize: "13px",
            color: "rgba(231,192,113,0.18)",
            fontFamily: "serif",
            letterSpacing: "12px",
            userSelect: "none",
          }}
        >
          ♠♥♦♣♠♥♦♣
        </div>
        </footer>
      </main>
    </div>
  );
}
