import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import LessonsSidebar from "@/components/LessonsSidebar";
import {
  buildEffectiveLessons,
  computeCurriculumStates,
  isCoreLesson,
  sectionLessonNumber,
} from "@/lib/lessons-config";
import {
  getAddedLessons,
  getAddedSections,
  getAnnouncements,
  getLessonOverrides,
  getViewerProgress,
} from "@/lib/lesson-store";
import { autoPassedLessonIds } from "@/lib/progress-link";
import { getWatchProgressByLesson } from "@/lib/watch-progress-store";

export const dynamic = "force-dynamic";

export default async function LessonsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session.user.discordId === process.env.ADMIN_DISCORD_ID;

  const discordId = session.user.discordId || session.user.id || "unknown";
  const [progress, announcements, addedLessons, overrides, addedSections] =
    await Promise.all([
      getViewerProgress(discordId),
      getAnnouncements(),
      getAddedLessons(),
      getLessonOverrides(),
      getAddedSections(),
    ]);

  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const completedLessonIds = autoPassedLessonIds(
    discordId,
    progress.completedLessons,
    lessons.map((lesson) => lesson.id)
  );
  const watchProgressByLesson = await getWatchProgressByLesson(discordId);
  // CORE advances independently; supplemental groups share the CORE 04 gate.
  const curriculum = computeCurriculumStates(
    completedLessonIds,
    lessons,
    isAdmin
  );
  const states = curriculum.states;
  const currentState = curriculum.coreStates.find((s) => s.current);

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      <TopNav active="/dashboard/lessons" />

      <main
        className="lessons-layout"
        style={{
          marginTop: "76px",
          minHeight: "calc(100vh - 76px)",
          display: "flex",
          alignItems: "stretch",
        }}
      >
        {/* Lessons sub-navigation */}
        <LessonsSidebar
          completedLessons={completedLessonIds}
          lessons={lessons}
          addedSections={addedSections}
          isAdmin={isAdmin}
          watchProgressByLesson={watchProgressByLesson}
        />

        {/* Content */}
        <div
          className="lessons-content"
          style={{
            flex: 1,
            padding: "60px 56px",
            position: "relative",
            minWidth: 0,
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
            修
          </div>

          {/* Header */}
          <div
            style={{
              borderBottom: "1px solid rgba(232,160,160,0.15)",
              paddingBottom: "32px",
              marginBottom: "40px",
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
              Lessons
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
              The Curriculum
            </h1>
          </div>

          {/* Announcements */}
          {announcements.length > 0 && (
            <section style={{ marginBottom: "48px" }}>
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
                Announcements
              </p>

              <div
                style={{ display: "flex", flexDirection: "column", gap: "16px" }}
              >
                {announcements.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      borderLeft: "3px solid #E8A0A0",
                      background: "rgba(232,160,160,0.06)",
                      padding: "16px 20px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "14px",
                        color: "#E8A0A0",
                        fontFamily: "Georgia, serif",
                        letterSpacing: "1px",
                        marginBottom: "6px",
                      }}
                    >
                      {a.title}
                    </p>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "rgba(245,240,240,0.75)",
                        fontFamily: "Georgia, serif",
                        lineHeight: 1.8,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {a.body}
                    </p>
                    <p
                      style={{
                        fontSize: "10px",
                        color: "rgba(245,240,240,0.35)",
                        fontFamily: "Georgia, serif",
                        marginTop: "10px",
                        letterSpacing: "1px",
                      }}
                    >
                      {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Start / continue CTA */}
          <section>
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
              Your Path
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: "16px",
                maxWidth: "760px",
              }}
            >
              {states.map((s) => {
                const locked = !s.unlocked;
                return (
                  <Link
                    key={s.lesson.id}
                    href={`/dashboard/lessons/${s.lesson.id}`}
                    style={{
                      display: "block",
                      padding: "20px 22px",
                      border: s.current
                        ? "1px solid rgba(232,160,160,0.35)"
                        : "1px solid rgba(232,160,160,0.12)",
                      background: "rgba(232,160,160,0.04)",
                      textDecoration: "none",
                      opacity: locked ? 0.5 : 1,
                    }}
                  >
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
                          color: "rgba(232,160,160,0.6)",
                          textTransform: "uppercase",
                          fontFamily: "Georgia, serif",
                        }}
                      >
                        {isCoreLesson(s.lesson) ? "Core" : s.lesson.group} · Lesson {String(sectionLessonNumber(s.lesson.id, lessons)).padStart(2, "0")}
                      </span>
                      <span
                        className={`lesson-card-status ${s.unlocked && s.completed ? "completed" : ""}`}
                        aria-label={locked ? "Locked until CORE Lecture 04 is passed" : s.completed ? "Completed" : s.current ? "Current lesson" : undefined}
                        title={s.completed ? "Completed" : undefined}
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
                      }}
                    >
                      {s.lesson.description}
                    </p>
                    {s.unlocked && watchProgressByLesson[s.lesson.id] && (
                      <p
                        style={{
                          marginTop: "9px",
                          fontSize: "10px",
                          color: "rgba(232,160,160,0.7)",
                          fontFamily: "Georgia, serif",
                        }}
                      >
                        Watch progress · {watchProgressByLesson[s.lesson.id].percent}%
                      </p>
                    )}
                    {locked && !isCoreLesson(s.lesson) && (
                      <p
                        style={{
                          marginTop: "10px",
                          fontSize: "10px",
                          color: "rgba(232,160,160,0.65)",
                          fontFamily: "Georgia, serif",
                          lineHeight: 1.5,
                        }}
                      >
                        Locked until CORE Lecture 04 is passed.
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>

            {currentState && (
              <div style={{ marginTop: "32px" }}>
                <Link
                  href={`/dashboard/lessons/${currentState.lesson.id}`}
                  className="btn-discord"
                  style={{ textDecoration: "none" }}
                >
                  {currentState.index === 0
                    ? "Start with Lesson 1"
                    : `Continue · ${currentState.lesson.title}`}
                </Link>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
