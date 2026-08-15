"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  computeCurriculumStates,
  getLessonGroups,
  isCoreLesson,
  LESSONS,
  sectionLessonNumber,
  type Lesson,
} from "@/lib/lessons-config";
import type { WatchProgress } from "@/lib/watch-progress";
import AddLessonForm from "@/components/AddLessonForm";
import SectionAdminControls from "@/components/SectionAdminControls";
import LessonAdminMenu from "@/components/LessonAdminMenu";
import { LESSONS as STATIC_LESSONS } from "@/lib/lessons-config";

// Static/built-in lesson ids — those live in lessons-config.ts and can't be
// deleted at runtime. Anything not in this set is admin-added and removable.
const STATIC_LESSON_IDS = new Set(STATIC_LESSONS.map((l) => l.id));

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
  watchProgressByLesson?: Record<string, WatchProgress>;
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
  watchProgressByLesson = {},
}: LessonsSidebarProps) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Drag-to-reorder state. `dragging` remembers which lesson is in flight and
  // which section bucket it came from — drops are only honoured inside that
  // same bucket. `dropTargetId` is purely visual (the insertion line).
  const [dragging, setDragging] = useState<{
    id: string;
    group: string;
  } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Section name whose new order is currently being persisted, if any.
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<{
    group: string;
    message: string;
  } | null>(null);
  const curriculum = computeCurriculumStates(completedLessons, lessons, isAdmin);
  const { stateById } = curriculum;

  // Curriculum progress represents the required CORE path only.
  const total = curriculum.coreStates.length;
  const done = curriculum.coreStates.filter((s) => s.completed).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const groups = getLessonGroups(lessons, addedSections).sort((a, b) => {
    const aCore = a.lessons.some(isCoreLesson) ? 1 : 0;
    const bCore = b.lessons.some(isCoreLesson) ? 1 : 0;
    return bCore - aCore;
  });

  // A save is in flight — freeze dragging everywhere so two reorders can't race.
  const isSaving = savingGroup !== null;

  function clearDrag() {
    setDragging(null);
    setDropTargetId(null);
  }

  /**
   * Persist a section's complete new order. The endpoint validates that the id
   * set matches the section exactly, so we always send every id in the bucket.
   */
  async function saveOrder(groupName: string, lessonIds: string[]) {
    setSavingGroup(groupName);
    setOrderError(null);
    try {
      const res = await fetch("/api/admin/lesson-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: groupName, lessonIds }),
      });
      if (!res.ok) {
        setOrderError({
          group: groupName,
          message: "Could not save the new order.",
        });
        return;
      }
      router.refresh();
    } catch {
      setOrderError({
        group: groupName,
        message: "Could not save the new order.",
      });
    } finally {
      setSavingGroup(null);
    }
  }

  /** Drop handler: pull the dragged id out, slot it back in at the target row. */
  function handleDrop(
    groupName: string,
    sectionIds: string[],
    targetId: string
  ) {
    const active = dragging;
    // Always clear first, so no highlight can survive a rejected drop.
    clearDrag();
    if (isSaving || !active || active.group !== groupName) return;
    if (active.id === targetId) return;

    // Both indexes come from the ORIGINAL order — comparing them is what tells
    // us the drag direction. Mixing an original index into the already-filtered
    // array is what used to land downward drags one slot past the drop line.
    const sourceIndex = sectionIds.indexOf(active.id);
    const targetIndex = sectionIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const next = sectionIds.filter((id) => id !== active.id);
    // Dragging down lands below the highlighted row, dragging up lands above
    // it — matching the edge the insertion line is drawn on.
    const anchor = next.indexOf(targetId);
    next.splice(sourceIndex < targetIndex ? anchor + 1 : anchor, 0, active.id);
    saveOrder(groupName, next);
  }

  return (
    <>
    <button
      type="button"
      className="lessons-mobile-toggle"
      aria-expanded={mobileOpen}
      onClick={() => setMobileOpen((open) => !open)}
    >
      <span>Lessons · {pct}% complete</span>
      <span aria-hidden>{mobileOpen ? "Close" : "Browse"}</span>
    </button>
    <aside
      className={`lessons-sidebar ${mobileOpen ? "mobile-open" : ""}`}
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
          const groupDone = groupStates.filter(
            (s) => s.unlocked && s.completed
          ).length;
          const isSupplementalGroup = !group.lessons.some(isCoreLesson);

          const sectionHasStatic = group.lessons.some((l) =>
            STATIC_LESSON_IDS.has(l.id)
          );

          return (
            <div key={group.group} style={{ marginBottom: "8px" }}>
              {/* Group header — admin kebab tucks in on the right, only
                 visible when the row is hovered (or the menu is open). */}
              <div
                className="kebab-visible-on-hover"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 28px",
                  borderTop: "1px solid rgba(232,160,160,0.08)",
                  borderBottom: "1px solid rgba(232,160,160,0.08)",
                  gap: 8,
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
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
                  {isAdmin && (
                    <SectionAdminControls
                      section={group.group}
                      canRename={!sectionHasStatic}
                    />
                  )}
                </div>
              </div>

              {isSupplementalGroup &&
                !isAdmin &&
                !curriculum.supplementalUnlocked && (
                  <p
                    style={{
                      padding: "0 28px 10px",
                      fontSize: "9px",
                      lineHeight: 1.5,
                      color: "rgba(232,160,160,0.55)",
                      fontFamily: "Georgia, serif",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Locked until CORE Lecture 04 is passed.
                  </p>
                )}

              {/* Lessons in group */}
              {groupStates.map((s) => {
                const isActive = s.lesson.id === activeLessonId;
                const icon = !s.unlocked ? "🔒" : s.completed ? "✓" : s.current ? "→" : "";
                const sectionIds = groupStates.map(
                  (state) => state.lesson.id
                );

                // Admins can drag rows to reorder, except while a save runs.
                const canDrag = isAdmin && !isSaving;
                const isDragged = dragging?.id === s.lesson.id;
                // Only same-section rows light up — cross-group drops are ignored.
                const isDropTarget =
                  dropTargetId === s.lesson.id &&
                  dragging !== null &&
                  dragging.group === group.group &&
                  dragging.id !== s.lesson.id;
                // The line marks where the row will actually land: below the
                // target when dragging down, above it when dragging up.
                const dropsBelow =
                  isDropTarget &&
                  dragging !== null &&
                  sectionIds.indexOf(dragging.id) <
                    sectionIds.indexOf(s.lesson.id);

                return (
                  <div
                    key={s.lesson.id}
                    className={`kebab-visible-on-hover${
                      isAdmin ? " lesson-row-draggable" : ""
                    }`}
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) return;
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", s.lesson.id);
                      setDragging({ id: s.lesson.id, group: group.group });
                    }}
                    onDragOver={(e) => {
                      // preventDefault is what marks a row as a legal drop
                      // target — withhold it for other sections entirely.
                      if (
                        isSaving ||
                        !dragging ||
                        dragging.group !== group.group
                      )
                        return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dropTargetId !== s.lesson.id) {
                        setDropTargetId(s.lesson.id);
                      }
                    }}
                    onDragLeave={() => {
                      setDropTargetId((current) =>
                        current === s.lesson.id ? null : current
                      );
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(group.group, sectionIds, s.lesson.id);
                    }}
                    onDragEnd={clearDrag}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "stretch",
                      background: isActive
                        ? "rgba(232,160,160,0.06)"
                        : "transparent",
                      borderLeft: isActive
                        ? "2px solid #E8A0A0"
                        : "2px solid transparent",
                      // Insertion line is an inset shadow so nothing reflows.
                      boxShadow: isDropTarget
                        ? dropsBelow
                          ? "inset 0 -2px 0 #E8A0A0"
                          : "inset 0 2px 0 #E8A0A0"
                        : undefined,
                      opacity: isDragged ? 0.4 : isSaving && isAdmin ? 0.6 : 1,
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    <Link
                      href={`/dashboard/lessons/${s.lesson.id}`}
                      // The anchor's native drag would hijack the row drag.
                      draggable={false}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "10px",
                        padding: "12px 28px",
                        textDecoration: "none",
                        fontFamily: "Georgia, serif",
                        cursor: "pointer",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "11px",
                          letterSpacing: "1px",
                          lineHeight: 1.5,
                          color: !s.unlocked
                            ? "rgba(245,240,240,0.3)"
                            : s.completed
                            ? "rgba(245,240,240,0.75)"
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
                          {String(sectionLessonNumber(s.lesson.id, lessons)).padStart(2, "0")}
                        </span>
                        {s.lesson.title}
                        {s.unlocked && watchProgressByLesson[s.lesson.id] && (
                          <span
                            style={{
                              display: "block",
                              marginTop: "2px",
                              color: "rgba(232,160,160,0.5)",
                              fontSize: "9px",
                            }}
                          >
                            {watchProgressByLesson[s.lesson.id].percent}% watched
                          </span>
                        )}
                      </span>

                      <span
                        style={{
                          fontSize: "12px",
                          flex: "0 0 auto",
                          color: !s.unlocked
                            ? "rgba(245,240,240,0.25)"
                            : s.completed
                              ? "#E8A0A0"
                              : "rgba(245,240,240,0.25)",
                        }}
                      >
                        {icon}
                      </span>
                    </Link>

                    {isAdmin && (
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          right: 6,
                          transform: "translateY(-50%)",
                          background: isActive
                            ? "rgba(20,10,10,0.9)"
                            : "rgba(0,0,0,0.85)",
                          borderRadius: 3,
                        }}
                      >
                        <LessonAdminMenu
                          lessonId={s.lesson.id}
                          title={s.lesson.title}
                          group={s.lesson.group}
                          sectionIds={sectionIds}
                          // The delete endpoint now hides built-in lessons
                          // rather than refusing, so every row offers it.
                          canDelete={true}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Reorder failed — the rendered order is unchanged. */}
              {orderError?.group === group.group && (
                <p
                  style={{
                    padding: "2px 28px 8px",
                    fontSize: "9px",
                    lineHeight: 1.5,
                    letterSpacing: "0.5px",
                    color: "#E8807A",
                    fontFamily: "Georgia, serif",
                    fontStyle: "italic",
                  }}
                >
                  {orderError.message}
                </p>
              )}

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

              {/* Admin: add a lesson to this section — the rename/delete
                 controls live in the section header kebab (above). */}
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
    </>
  );
}
