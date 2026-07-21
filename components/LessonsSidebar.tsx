import {
  computeLessonStates,
  getLessonGroups,
  LESSONS,
  type Lesson,
} from "@/lib/lessons-config";
import AddLessonForm from "@/components/AddLessonForm";
import SectionAdminControls from "@/components/SectionAdminControls";

interface LessonsSidebarProps {
  completedLessons: string[];
  /** Currently open lesson id, if any (highlighted with a pink left border). */
  activeLessonId?: string;
  /** Effective curriculum (static + admin-added, overrides applied). */
  lessons?: Lesson[];
  /** Admin-added empty section names — rendered even with zero lessons. */
  addedSections?: string[];
  /** When true, show admin "add lesson"/"add section" controls. */
  isAdmin?: boolean;
}

/**
 * The lessons sub-navigation column. Server component — every entry is a plain
 * `<a href>` so it works without client JS. Shows a progress bar, then the
 * curriculum grouped by `group`, with per-lesson completed / locked / current
 * indicators. Admins additionally see inline add-lesson / add-section controls.
 */
export default function LessonsSidebar({
  completedLessons,
  activeLessonId,
  lessons = LESSONS,
  addedSections = [],
  isAdmin = false,
}: LessonsSidebarProps) {
  const states = computeLessonStates(completedLessons, lessons);
  const stateById = new Map(states.map((s) => [s.lesson.id, s]));

  const total = states.length;
  const done = states.filter((s) => s.completed).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const groups = getLessonGroups(lessons, addedSections);

  return (
    <aside
      style={{
        width: "240px",
        flex: "0 0 240px",
        background: "#000000",
        borderRight: "1px solid rgba(232,160,160,0.12)",
        padding: "40px 0",
        minHeight: "100vh",
      }}
    >
      {/* Section label */}
      <div style={{ padding: "0 28px 24px" }}>
        <p
          style={{
            fontSize: "11px",
            letterSpacing: "5px",
            color: "#E8A0A0",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
          }}
        >
          Lessons
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ padding: "0 28px 28px" }}>
        <div
          style={{
            height: "2px",
            width: "100%",
            background: "rgba(232,160,160,0.15)",
            marginBottom: "10px",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "#E8A0A0",
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <p
          style={{
            fontSize: "10px",
            letterSpacing: "1px",
            color: "rgba(245,240,240,0.55)",
            fontFamily: "Georgia, serif",
          }}
        >
          {done} / {total} lessons completed
          <span style={{ color: "rgba(232,160,160,0.6)" }}> · {pct}%</span>
        </p>
      </div>

      {/* Groups */}
      <nav>
        {groups.map((group) => {
          const groupStates = group.lessons
            .map((l) => stateById.get(l.id))
            .filter((s): s is NonNullable<typeof s> => Boolean(s));
          const groupDone = groupStates.filter((s) => s.completed).length;

          return (
            <div key={group.group} style={{ marginBottom: "8px" }}>
              {/* Group header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 28px",
                  borderTop: "1px solid rgba(232,160,160,0.08)",
                  borderBottom: "1px solid rgba(232,160,160,0.08)",
                }}
              >
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: "3px",
                    color: "rgba(245,240,240,0.4)",
                    textTransform: "uppercase",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  {group.group}
                </span>
                <span
                  style={{
                    fontSize: "9px",
                    letterSpacing: "1px",
                    color: "rgba(232,160,160,0.55)",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  {groupDone}/{group.lessons.length}
                </span>
              </div>

              {/* Lessons in group */}
              {groupStates.map((s) => {
                const isActive = s.lesson.id === activeLessonId;
                const icon = s.completed ? "✓" : !s.unlocked ? "🔒" : s.current ? "→" : "";

                return (
                  <a
                    key={s.lesson.id}
                    href={`/dashboard/lessons/${s.lesson.id}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      padding: "12px 28px",
                      textDecoration: "none",
                      fontFamily: "Georgia, serif",
                      background: isActive
                        ? "rgba(232,160,160,0.06)"
                        : "transparent",
                      borderLeft: isActive
                        ? "2px solid #E8A0A0"
                        : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "11px",
                        letterSpacing: "1px",
                        lineHeight: 1.5,
                        color: s.completed
                          ? "rgba(245,240,240,0.75)"
                          : !s.unlocked
                          ? "rgba(245,240,240,0.3)"
                          : isActive
                          ? "#F0B0B0"
                          : "rgba(245,240,240,0.6)",
                      }}
                    >
                      <span
                        style={{
                          color: "rgba(232,160,160,0.5)",
                          marginRight: "8px",
                        }}
                      >
                        {String(s.index + 1).padStart(2, "0")}
                      </span>
                      {s.lesson.title}
                    </span>

                    <span
                      style={{
                        fontSize: "12px",
                        flex: "0 0 auto",
                        color: s.completed
                          ? "#E8A0A0"
                          : "rgba(245,240,240,0.25)",
                      }}
                    >
                      {icon}
                    </span>
                  </a>
                );
              })}

              {/* Empty section — no lessons added yet */}
              {groupStates.length === 0 && (
                <p
                  style={{
                    padding: "12px 28px",
                    fontSize: "11px",
                    letterSpacing: "1px",
                    lineHeight: 1.5,
                    color: "rgba(245,240,240,0.3)",
                    fontFamily: "Georgia, serif",
                    fontStyle: "italic",
                  }}
                >
                  No lessons yet
                </p>
              )}

              {/* Admin: rename / delete this section */}
              {isAdmin && <SectionAdminControls section={group.group} />}

              {/* Admin: add a lesson to this section */}
              {isAdmin && <AddLessonForm section={group.group} />}
            </div>
          );
        })}

        {/* Admin: add a brand-new section */}
        {isAdmin && (
          <div style={{ marginTop: "16px" }}>
            <AddLessonForm />
          </div>
        )}
      </nav>
    </aside>
  );
}
