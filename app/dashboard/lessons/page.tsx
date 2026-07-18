import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import LessonsSidebar from "@/components/LessonsSidebar";
import { computeLessonStates } from "@/lib/lessons-config";
import { getAnnouncements, getUserProgress } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

export default async function LessonsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const discordId = session.user.discordId || session.user.id || "unknown";
  const [progress, announcements] = await Promise.all([
    getUserProgress(discordId),
    getAnnouncements(),
  ]);

  const states = computeLessonStates(progress.completedLessons);
  const currentState = states.find((s) => s.current);

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      <Sidebar active="/dashboard/lessons" />

      <main
        style={{
          marginLeft: "220px",
          minHeight: "100vh",
          display: "flex",
          alignItems: "stretch",
        }}
      >
        {/* Lessons sub-navigation */}
        <LessonsSidebar completedLessons={progress.completedLessons} />

        {/* Content */}
        <div
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
                  <a
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
                        Lesson {String(s.index + 1).padStart(2, "0")}
                      </span>
                      <span style={{ fontSize: "12px", color: "#E8A0A0" }}>
                        {s.completed ? "✓" : locked ? "🔒" : s.current ? "→" : ""}
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
                  </a>
                );
              })}
            </div>

            {currentState && (
              <div style={{ marginTop: "32px" }}>
                <a
                  href={`/dashboard/lessons/${currentState.lesson.id}`}
                  className="btn-discord"
                  style={{ textDecoration: "none" }}
                >
                  {currentState.index === 0
                    ? "Start with Lesson 1"
                    : `Continue · ${currentState.lesson.title}`}
                </a>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
