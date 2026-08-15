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
import { buildEffectiveLessons } from "@/lib/lessons-config";
import {
  buildCoreLearningSummary,
  buildOverviewStats,
} from "@/lib/overview-stats";
import SupportLink from "@/components/SupportLink";
import MyHomeworkCard from "@/components/MyHomeworkCard";
import { listHomeworkArchive } from "@/lib/homework-archive";

export const dynamic = "force-dynamic";

// Subtle kanji used as decorative corner/accent elements
const KANJI_ACCENTS = ["道", "剣", "心", "武", "礼", "修", "練", "気"];

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
  });

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
            Welcome, {identity.name?.split(" ")[0] || "Member"}
          </h1>
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

        {/* Stats cards */}
        <div className="overview-stats-grid">
          {overviewStats.map((card) => {
            const href =
              card.label === "Lectures"
                ? "/dashboard/lessons"
                : card.label === "Journal"
                  ? "/dashboard/journal"
                  : "/dashboard";
            return (
            <Link
              key={card.label}
              href={href}
              className="overview-stat-card"
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
                  fontSize: "10px",
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

        <MyHomeworkCard items={homeworkArchive.page.items} error={homeworkArchive.error} />

        {/* Announcements — live feed, unread pulses burgundy. */}
        <AnnouncementsFeed items={announcements} initialSeen={seen} />

        <footer className="dashboard-footer">
        <SupportLink>Support and access appeals</SupportLink>
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
        </footer>
      </main>
    </div>
  );
}
