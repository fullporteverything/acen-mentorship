import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import LessonsSidebar from "@/components/LessonsSidebar";
import VideoPlayer from "@/components/VideoPlayer";
import VideoAssign from "@/components/VideoAssign";
import HomeworkUpload from "@/components/HomeworkUpload";
import EditableText from "@/components/EditableText";
import SupportLink from "@/components/SupportLink";
import {
  buildEffectiveLessons,
  computeCurriculumStates,
  getLesson,
  getLessonNavigation,
  isCoreLesson,
  sectionLessonNumber,
} from "@/lib/lessons-config";
import {
  getAddedLessons,
  getAddedSections,
  getLessonOverrides,
  getViewerProgress,
  type SubmissionStatus,
} from "@/lib/lesson-store";
import { getKinescopeConfig } from "@/lib/kinescope";
import { isKinescopeVideoId } from "@/lib/video-id";
import { getVideoPlayback } from "@/lib/video-status";
import { autoPassedLessonIds } from "@/lib/progress-link";
import { getWatchProgressByLesson } from "@/lib/watch-progress-store";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<SubmissionStatus, string> = {
  pending: "#E8C86A", // yellow
  approved: "#8FD19E", // green
  rejected: "#E8807A", // red
};

/**
 * Href for a stored homework PDF. New submissions store a blob PATHNAME served
 * through the private /api/blob proxy; legacy rows may hold a full public URL.
 */
const blobHref = (value: string) =>
  value.startsWith("http") ? value : `/api/blob/${value}`;

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const identity = await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error) ?? redirect("/"));
  const isAdmin = identity.isAdmin;
  const discordId = identity.discordId;
  const discordUsername = identity.name?.trim() || "Discord user";
  const [progress, addedLessons, overrides, addedSections] = await Promise.all([
    getViewerProgress(discordId),
    getAddedLessons(),
    getLessonOverrides(),
    getAddedSections(),
  ]);

  const lessons = buildEffectiveLessons(addedLessons, overrides);
  const completedLessonIds = autoPassedLessonIds(
    discordId,
    progress.completedLessons,
    lessons.map((item) => item.id)
  );
  const lesson = getLesson(lessonId, lessons);
  if (!lesson) {
    notFound();
  }

  const curriculum = computeCurriculumStates(
    completedLessonIds,
    lessons,
    isAdmin
  );
  const unlocked = curriculum.stateById.get(lesson.id)?.unlocked ?? false;
  const submission = progress.submissions[lesson.id];
  const lessonNumber = sectionLessonNumber(lesson.id, lessons);

  let protectedPlaybackConfigured = false;
  try {
    getKinescopeConfig();
    protectedPlaybackConfigured = true;
  } catch {
    // The player fails closed below when protected Kinescope config is absent.
  }

  const videoIdPlausible = isKinescopeVideoId(lesson.videoId);
  const playback =
    unlocked && videoIdPlausible && protectedPlaybackConfigured
      ? await getVideoPlayback(lesson.videoId)
      : { ready: false, embedUrl: null };
  const videoProcessing =
    unlocked &&
    videoIdPlausible &&
    protectedPlaybackConfigured &&
    !playback.ready;
  const watchProgressByLesson = unlocked
    ? await getWatchProgressByLesson(discordId)
    : {};
  const initialWatchProgress = watchProgressByLesson[lesson.id] || null;
  const navigation = getLessonNavigation(
    lesson.id,
    completedLessonIds,
    lessons,
    isAdmin
  );

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
        <LessonsSidebar
          completedLessons={completedLessonIds}
          activeLessonId={lesson.id}
          lessons={lessons}
          addedSections={addedSections}
          isAdmin={isAdmin}
          watchProgressByLesson={watchProgressByLesson}
        />

        <div
          className="lessons-content"
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
                  color: "rgba(245,240,240,0.72)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                  lineHeight: 1.8,
                }}
              >
                {isCoreLesson(lesson)
                  ? "Complete the previous CORE lesson’s homework to unlock this lesson."
                  : curriculum.supplementalGateLesson
                    ? `Complete CORE Lecture 04 — ${curriculum.supplementalGateLesson.title} to unlock this category.`
                    : "This category unlocks after CORE Lecture 04 is available and completed."}
              </p>
              <div style={{ marginTop: "22px" }}>
                <SupportLink>Need help with lesson access?</SupportLink>
              </div>
            </div>
          ) : (
            <>
              {/* Video — full width of the content column */}
              <div style={{ width: "100%", marginBottom: "16px" }}>
                {videoProcessing ? (
                  /* Same 16:9 blackout frame VideoPlayer uses for its
                     "video coming soon" state, with an encoding-specific label. */
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      aspectRatio: "16 / 9",
                      background: "#000",
                      border: "1px solid rgba(232,160,160,0.15)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "Georgia, serif",
                        fontSize: "0.7rem",
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        color: "rgba(245,240,240,0.25)",
                        textAlign: "center",
                        padding: "0 20px",
                      }}
                    >
                      video is processing — check back in a few minutes
                    </div>
                  </div>
                ) : (
                  <VideoPlayer
                    key={lesson.id}
                    videoId={lesson.videoId}
                    embedUrl={playback.embedUrl}
                    lessonId={lesson.id}
                    initialWatchProgress={initialWatchProgress}
                    title={lesson.title}
                    discordId={discordId}
                    discordUsername={discordUsername}
                    protectedPlaybackConfigured={protectedPlaybackConfigured}
                  />
                )}
                {isAdmin && videoProcessing && (
                  <p
                    style={{
                      marginTop: "10px",
                      fontSize: "12px",
                      fontFamily: "Georgia, serif",
                      fontStyle: "italic",
                      color: "rgba(245,240,240,0.4)",
                      lineHeight: 1.7,
                    }}
                  >
                    Kinescope is still processing this upload. It plays
                    automatically when done.
                  </p>
                )}
                {isAdmin && (
                  <div style={{ marginTop: "10px" }}>
                    <VideoAssign
                      lessonId={lesson.id}
                      currentVideoId={lesson.videoId}
                    />
                  </div>
                )}
              </div>
              <EditableText
                as="p"
                isAdmin={isAdmin}
                lessonId={lesson.id}
                field="description"
                value={lesson.description}
                style={{
                  fontSize: "13px",
                  color: "rgba(245,240,240,0.7)",
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
                          color: "rgba(245,240,240,0.72)",
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
                      href={blobHref(submission.blobUrl)}
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
              <nav
                aria-label="Lesson navigation"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "16px",
                  maxWidth: "760px",
                  marginTop: "40px",
                  paddingTop: "24px",
                  borderTop: "1px solid rgba(232,160,160,0.15)",
                }}
              >
                {navigation.previous ? (
                  <Link
                    href={`/dashboard/lessons/${navigation.previous.id}`}
                    style={lessonNavigationStyle}
                  >
                    ← Previous · {navigation.previous.title}
                  </Link>
                ) : (
                  <span />
                )}
                {navigation.next ? (
                  <Link
                    href={`/dashboard/lessons/${navigation.next.id}`}
                    style={{ ...lessonNavigationStyle, textAlign: "right" }}
                  >
                    Next · {navigation.next.title} →
                  </Link>
                ) : navigation.nextLocked ? (
                  <span
                    style={{
                      color: "rgba(245,240,240,0.3)",
                      fontFamily: "Georgia, serif",
                      fontSize: "11px",
                      textAlign: "right",
                    }}
                  >
                    Next lesson unlocks after approval
                  </span>
                ) : (
                  <span />
                )}
              </nav>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const lessonNavigationStyle = {
  color: "#E8A0A0",
  fontFamily: "Georgia, serif",
  fontSize: "11px",
  letterSpacing: "0.8px",
  lineHeight: 1.5,
  textDecoration: "none",
} as const;
