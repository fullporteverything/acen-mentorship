import { auth } from "@/auth";
import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import AnnouncementsFeed from "@/components/AnnouncementsFeed";
import {
  getAddedLessons,
  getAnnouncements,
  getLessonOverrides,
  getSeenAnnouncements,
  getUserProgress,
} from "@/lib/lesson-store";
import { getJournal } from "@/lib/journal-store";
import { buildEffectiveLessons } from "@/lib/lessons-config";
import {
  buildOverviewStats,
  countCoreLessonProgress,
} from "@/lib/overview-stats";

export const dynamic = "force-dynamic";

// Subtle kanji used as decorative corner/accent elements
const KANJI_ACCENTS = ["道", "剣", "心", "武", "礼", "修", "練", "気"];

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const discordId =
    session.user.discordId || session.user.id || "unknown";
  const [announcements, seen, progress, addedLessons, overrides, journal] =
    await Promise.all([
    getAnnouncements(),
    getSeenAnnouncements(discordId),
    getUserProgress(discordId),
    getAddedLessons(),
    getLessonOverrides(),
    getJournal(discordId),
  ]);
  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const coreProgress = countCoreLessonProgress(
    lessons,
    progress.completedLessons
  );
  const overviewStats = buildOverviewStats({
    ...coreProgress,
    journalEntries: journal.length,
  });

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      {/* Top nav */}
      <TopNav active="/dashboard" />

      {/* Main content */}
      <main
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
          {overviewStats.map((card) => (
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

        {/* Announcements — live feed, unread pulses burgundy. */}
        <AnnouncementsFeed items={announcements} initialSeen={seen} />

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
