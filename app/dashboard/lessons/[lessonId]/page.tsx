import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import LessonsSidebar from "@/components/LessonsSidebar";
import CloudflarePlayer from "@/components/CloudflarePlayer";
import HomeworkUpload from "@/components/HomeworkUpload";
import EditableText from "@/components/EditableText";
import {
  buildEffectiveLessons,
  getLesson,
  isLessonUnlocked,
} from "@/lib/lessons-config";
import {
  getAddedLessons,
  getLessonOverrides,
  getUserProgress,
  type SubmissionStatus,
} from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<SubmissionStatus, string> = {
  pending: "#E8C86A", // yellow
  approved: "#8FD19E", // green
  rejected: "#E8807A", // red
};

export default async function LessonPage({
  params,
}: {
  params: { lessonId: string };
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session.user.discordId === process.env.ADMIN_DISCORD_ID;

  const discordId = session.user.discordId || session.user.id || "unknown";
  const [progress, addedLessons, overrides] = await Promise.all([
    getUserProgress(discordId),
    getAddedLessons(),
    getLessonOverrides(),
  ]);

  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const lesson = getLesson(params.lessonId, lessons);
  if (!lesson) {
    notFound();
  }

  const unlocked = isLessonUnlocked(
    lesson.id,
    progress.completedLessons,
    lessons
  );
  const submission = progress.submissions[lesson.id];
  const lessonNumber = lessons.findIndex((l) => l.id === lesson.id) + 1;

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
        <LessonsSidebar
          completedLessons={progress.completedLessons}
          activeLessonId={lesson.id}
          lessons={lessons}
          isAdmin={isAdmin}
        />

        <div
          style={{
            flex: 1,
            padding: "60px 56px",
            position: "relative",
            minWidth: 0,
          }}
        >
          {/* Header */}
          <div
            style={{
              borderBottom: "1px solid rgba(232,160,160,0.15)",
              paddingBottom: "28px",
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
              Lesson {String(lessonNumber).padStart(2, "0")}
            </p>
            <EditableText
              as="h1"
              isAdmin={isAdmin}
              lessonId={lesson.id}
              field="title"
              value={lesson.title}
              style={{
                fontSize: "28px",
                fontWeight: 400,
                letterSpacing: "3px",
                color: "#F5F0F0",
                fontFamily: "Georgia, serif",
                display: "block",
              }}
            />
          </div>

          {!unlocked ? (
            /* Lock screen */
            <div
              style={{
                maxWidth: "480px",
                padding: "48px 40px",
                border: "1px solid rgba(232,160,160,0.15)",
                background: "rgba(232,160,160,0.02)",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontSize: "40px",
                  marginBottom: "18px",
                  opacity: 0.4,
                }}
              >
                🔒
              </p>
              <p
                style={{
                  fontSize: "13px",
                  color: "rgba(245,240,240,0.6)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                  lineHeight: 1.8,
                }}
              >
                Complete the previous lesson&rsquo;s homework to unlock this
                lesson.
              </p>
            </div>
          ) : (
            <>
              {/* Video */}
              <div style={{ maxWidth: "860px", marginBottom: "16px" }}>
                <CloudflarePlayer videoId={lesson.videoId} title={lesson.title} />
              </div>
              <EditableText
                as="p"
                isAdmin={isAdmin}
                lessonId={lesson.id}
                field="description"
                value={lesson.description}
                style={{
                  fontSize: "13px",
                  color: "rgba(245,240,240,0.55)",
                  fontFamily: "Georgia, serif",
                  lineHeight: 1.8,
                  maxWidth: "760px",
                  marginBottom: "48px",
                  display: "block",
                }}
              />

              {/* Homework */}
              <section style={{ maxWidth: "760px" }}>
                <p
                  style={{
                    fontSize: "11px",
                    letterSpacing: "4px",
                    color: "#E8A0A0",
                    textTransform: "uppercase",
                    fontFamily: "Georgia, serif",
                    marginBottom: "14px",
                  }}
                >
                  Homework
                </p>
                <div
                  style={{
                    height: "1px",
                    background: "rgba(232,160,160,0.15)",
                    marginBottom: "20px",
                  }}
                />

                <EditableText
                  as="p"
                  isAdmin={isAdmin}
                  lessonId={lesson.id}
                  field="homeworkPrompt"
                  value={lesson.homeworkPrompt}
                  style={{
                    fontSize: "14px",
                    color: "#F5F0F0",
                    fontFamily: "Georgia, serif",
                    lineHeight: 1.8,
                    marginBottom: "28px",
                    display: "block",
                  }}
                />

                {/* Status box */}
                {submission && (
                  <div
                    style={{
                      border: `1px solid ${STATUS_COLORS[submission.status]}55`,
                      background: "rgba(0,0,0,0.3)",
                      padding: "18px 22px",
                      marginBottom: "28px",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "12px",
                        fontFamily: "Georgia, serif",
                        letterSpacing: "1px",
                        color: "rgba(245,240,240,0.7)",
                        marginBottom: submission.feedback ? "10px" : 0,
                      }}
                    >
                      Status:{" "}
                      <span
                        style={{
                          color: STATUS_COLORS[submission.status],
                          textTransform: "uppercase",
                          letterSpacing: "2px",
                        }}
                      >
                        {submission.status}
                      </span>
                    </p>
                    {submission.feedback && (
                      <p
                        style={{
                          fontSize: "13px",
                          fontFamily: "Georgia, serif",
                          color: "rgba(245,240,240,0.6)",
                          lineHeight: 1.7,
                          fontStyle: "italic",
                        }}
                      >
                        Feedback: {submission.feedback}
                      </p>
                    )}
                  </div>
                )}

                {/* Approved banner */}
                {submission?.status === "approved" && (
                  <p
                    style={{
                      fontSize: "13px",
                      color: "#8FD19E",
                      fontFamily: "Georgia, serif",
                      letterSpacing: "1px",
                      marginBottom: "28px",
                    }}
                  >
                    ✓ Homework approved. You may proceed to the next lesson.
                  </p>
                )}

                {/* Upload form — shown unless already approved */}
                {submission?.status !== "approved" && (
                  <HomeworkUpload lessonId={lesson.id} />
                )}

                {/* Your submissions */}
                {submission && (
                  <div style={{ marginTop: "40px" }}>
                    <p
                      style={{
                        fontSize: "9px",
                        letterSpacing: "4px",
                        color: "rgba(232,160,160,0.6)",
                        textTransform: "uppercase",
                        fontFamily: "Georgia, serif",
                        marginBottom: "14px",
                      }}
                    >
                      Your Submissions
                    </p>
                    <a
                      href={submission.blobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "16px",
                        padding: "14px 18px",
                        border: "1px solid rgba(232,160,160,0.12)",
                        background: "rgba(232,160,160,0.04)",
                        textDecoration: "none",
                        fontFamily: "Georgia, serif",
                      }}
                    >
                      <span style={{ fontSize: "13px", color: "#F5F0F0" }}>
                        {submission.fileName}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          color: "rgba(245,240,240,0.4)",
                          letterSpacing: "1px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(submission.submittedAt).toLocaleDateString()} ·
                        View ↗
                      </span>
                    </a>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
