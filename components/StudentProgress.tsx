"use client";

import { useCallback, useEffect, useState } from "react";

interface Student {
  discordId: string;
  discordUsername: string;
  completedCount: number;
}

interface ProgressLesson {
  id: string;
  title: string;
  order: number;
}

/**
 * Admin section for manually moving a student through the curriculum.
 *
 * Lessons normally unlock one at a time as homework is approved. This section
 * lets the admin mark a student complete THROUGH a chosen lesson (union with
 * whatever they already had — nothing is taken away), or reset their
 * completions entirely. Submissions are never touched. Students with no
 * progress blob yet can be advanced via the manual Discord ID fallback at the
 * bottom, which creates their record.
 */
export default function StudentProgress() {
  const [students, setStudents] = useState<Student[]>([]);
  const [lessons, setLessons] = useState<ProgressLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/admin/progress");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setStudents(Array.isArray(data?.students) ? data.students : []);
      setLessons(Array.isArray(data?.lessons) ? data.lessons : []);
    } catch {
      setError(true);
      setStudents([]);
      setLessons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Student Progress</p>

      {loading ? (
        <SkeletonBar width="200px" />
      ) : error ? (
        <p style={errorItalic}>
          Couldn&apos;t load student progress — refresh to retry.
        </p>
      ) : (
        <>
          {students.length === 0 ? (
            <p style={{ ...mutedItalic, marginBottom: "24px" }}>
              No student progress yet.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                marginBottom: "28px",
              }}
            >
              {students.map((student) => (
                <StudentRow
                  key={student.discordId}
                  student={student}
                  lessons={lessons}
                  onDone={load}
                />
              ))}
            </div>
          )}

          <ManualAdvance lessons={lessons} onDone={load} />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One student
// ---------------------------------------------------------------------------

function StudentRow({
  student,
  lessons,
  onDone,
}: {
  student: Student;
  lessons: ProgressLesson[];
  onDone: () => Promise<void> | void;
}) {
  // Default the select to the lesson they'd be working on next.
  const defaultLessonId =
    lessons[Math.min(student.completedCount, Math.max(lessons.length - 1, 0))]
      ?.id || "";

  const [lessonId, setLessonId] = useState(defaultLessonId);
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [error, setError] = useState("");

  async function post(payload: Record<string, unknown>) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not update this student.");
        return;
      }
      setConfirmingReset(false);
      await onDone();
    } catch {
      setError("Could not update this student.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={rowStyle}>
      <p style={{ fontSize: "13px", color: "#F5F0F0", marginBottom: "4px" }}>
        {student.discordUsername}
        <span style={{ color: "rgba(245,240,240,0.35)" }}>
          {" "}
          · {student.discordId}
        </span>
      </p>
      <p
        style={{
          fontSize: "11px",
          color: "rgba(245,240,240,0.45)",
          marginBottom: "12px",
        }}
      >
        {student.completedCount} lesson
        {student.completedCount === 1 ? "" : "s"} completed
      </p>

      <div style={controlsStyle}>
        <select
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
          disabled={busy || lessons.length === 0}
          style={selectStyle}
        >
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {String(lesson.order).padStart(2, "0")} — {lesson.title}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() =>
            post({ discordId: student.discordId, throughLessonId: lessonId })
          }
          disabled={busy || !lessonId}
          style={{ ...smallBtn, opacity: busy || !lessonId ? 0.5 : 1 }}
        >
          {busy ? "Advancing…" : "Advance"}
        </button>

        {confirmingReset ? (
          <>
            <span style={confirmStyle}>reset progress?</span>
            <button
              type="button"
              onClick={() => post({ discordId: student.discordId, reset: true })}
              disabled={busy}
              style={resetActionStyle}
            >
              {busy ? "…" : "yes"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingReset(false)}
              disabled={busy}
              style={mutedActionStyle}
            >
              no
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError("");
              setConfirmingReset(true);
            }}
            disabled={busy}
            style={mutedActionStyle}
          >
            reset
          </button>
        )}
      </div>

      {error && <p style={inlineError}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual fallback — a student with no progress record yet
// ---------------------------------------------------------------------------

function ManualAdvance({
  lessons,
  onDone,
}: {
  lessons: ProgressLesson[];
  onDone: () => Promise<void> | void;
}) {
  const [discordId, setDiscordId] = useState("");
  const [lessonId, setLessonId] = useState(lessons[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function advance(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const id = discordId.trim();
    if (!id) {
      setError("A Discord ID is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId: id, throughLessonId: lessonId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Could not update this student.");
        return;
      }
      setDiscordId("");
      await onDone();
    } catch {
      setError("Could not update this student.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={advance}>
      <p
        style={{
          ...mutedItalic,
          fontSize: "11px",
          marginBottom: "10px",
        }}
      >
        No record yet? Advance by Discord ID — their progress is created.
      </p>
      <div style={controlsStyle}>
        <input
          type="text"
          placeholder="Discord ID…"
          value={discordId}
          onChange={(e) => setDiscordId(e.target.value)}
          disabled={busy}
          style={manualInputStyle}
        />
        <select
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
          disabled={busy || lessons.length === 0}
          style={selectStyle}
        >
          {lessons.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>
              {String(lesson.order).padStart(2, "0")} — {lesson.title}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !lessonId || !discordId.trim()}
          style={{
            ...smallBtn,
            opacity: busy || !lessonId || !discordId.trim() ? 0.5 : 1,
          }}
        >
          {busy ? "Advancing…" : "Advance"}
        </button>
      </div>
      {error && <p style={inlineError}>{error}</p>}
    </form>
  );
}

/** Minimal on-theme pulsing skeleton bar used in place of "Loading…" text. */
function SkeletonBar({ width = "140px" }: { width?: string }) {
  return (
    <div
      aria-hidden
      style={{
        width,
        height: "12px",
        borderRadius: "3px",
        background: "rgba(232,160,160,0.08)",
        animation: "dojoPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "4px",
  color: "#E8A0A0",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  marginBottom: "18px",
};

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(232,160,160,0.12)",
  background: "rgba(232,160,160,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};

const mutedItalic: React.CSSProperties = {
  fontSize: "13px",
  color: "rgba(245,240,240,0.45)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};

/** Same muted-italic voice, but tinted with the error rose to signal a failure. */
const errorItalic: React.CSSProperties = {
  ...mutedItalic,
  color: "#E8807A",
};

const rowStyle: React.CSSProperties = {
  padding: "14px 16px",
  border: "1px solid rgba(232,160,160,0.10)",
  background: "rgba(0,0,0,0.25)",
  fontFamily: "Georgia, serif",
};

const controlsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px",
};

const selectStyle: React.CSSProperties = {
  padding: "7px 10px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(232,160,160,0.2)",
  color: "#F5F0F0",
  fontFamily: "Georgia, serif",
  fontSize: "12px",
  outline: "none",
  maxWidth: "280px",
};

const manualInputStyle: React.CSSProperties = {
  flex: "0 1 160px",
  minWidth: 0,
  padding: "7px 10px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(232,160,160,0.2)",
  color: "#F5F0F0",
  fontFamily: "Georgia, serif",
  fontSize: "12px",
  outline: "none",
  boxSizing: "border-box",
};

const smallBtn: React.CSSProperties = {
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  padding: "8px 16px",
  background: "transparent",
  border: "1px solid rgba(232,160,160,0.4)",
  color: "#E8A0A0",
  cursor: "pointer",
};

/** Bare inline affordance, matching SectionAdminControls' quiet actions. */
const mutedActionStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "rgba(245,240,240,0.5)",
  fontFamily: "Georgia, serif",
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
};

const resetActionStyle: React.CSSProperties = {
  ...mutedActionStyle,
  color: "#E8807A",
};

const confirmStyle: React.CSSProperties = {
  color: "rgba(245,240,240,0.6)",
  fontFamily: "Georgia, serif",
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
};

const inlineError: React.CSSProperties = {
  marginTop: "8px",
  color: "#E8807A",
  fontFamily: "Georgia, serif",
  fontSize: "10px",
  fontStyle: "italic",
};
