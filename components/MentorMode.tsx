"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

/**
 * Mentor Mode — admin-only, lives on the Journal tab.
 *
 * A floating "Mentor Mode" button (rendered only for the admin) opens a
 * full-bleed overlay that replaces the member's own journal with a roster of
 * students. Selecting a student slides the roster to the left and drawer-opens
 * that student's journal, centered, where the mentor can leave per-entry
 * feedback (the member then sees it attached to that entry).
 *
 * Reuses /api/admin/journal-feedback (GET all entries, POST per-entry feedback);
 * the endpoint is admin-gated server-side, so the hidden button is UX only.
 */

interface MentorEntry {
  id: string;
  discordId: string;
  discordUsername: string;
  body: string;
  createdAt: string;
  feedback?: string;
  feedbackAt?: string;
}

interface Student {
  discordId: string;
  discordUsername: string;
  entries: MentorEntry[];
}

export default function MentorMode({ isAdmin }: { isAdmin: boolean }) {
  const [active, setActive] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/journal-feedback");
      const data = res.ok ? await res.json() : { entries: [] };
      const entries: MentorEntry[] = Array.isArray(data?.entries)
        ? data.entries
        : [];

      const map = new Map<string, Student>();
      for (const e of entries) {
        let s = map.get(e.discordId);
        if (!s) {
          s = {
            discordId: e.discordId,
            discordUsername: e.discordUsername,
            entries: [],
          };
          map.set(e.discordId, s);
        }
        s.entries.push(e);
      }
      const list = Array.from(map.values()).sort((a, b) =>
        a.discordUsername.localeCompare(b.discordUsername)
      );
      setStudents(list);

      const d: Record<string, string> = {};
      for (const e of entries) d[`${e.discordId}:${e.id}`] = e.feedback || "";
      setDrafts(d);
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  if (!isAdmin) return null;

  const selected = students.find((s) => s.discordId === selectedId) || null;

  async function saveFeedback(entry: MentorEntry) {
    const key = `${entry.discordId}:${entry.id}`;
    setBusyKey(key);
    try {
      await fetch("/api/admin/journal-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordId: entry.discordId,
          entryId: entry.id,
          feedback: drafts[key] || "",
        }),
      });
      await load();
    } catch {
      // ignore
    } finally {
      setBusyKey(null);
    }
  }

  function close() {
    setActive(false);
    setSelectedId(null);
  }

  return (
    <>
      {/* Floating toggle — admin only. */}
      <button
        type="button"
        onClick={() => (active ? close() : setActive(true))}
        style={{
          position: "fixed",
          top: 88,
          right: 28,
          zIndex: 130,
          fontSize: 10,
          letterSpacing: 3,
          textTransform: "uppercase",
          fontFamily: "Georgia, serif",
          padding: "9px 18px",
          background: active ? "rgba(232,160,160,0.12)" : "rgba(0,0,0,0.6)",
          border: "1px solid rgba(232,160,160,0.45)",
          color: "#E8A0A0",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        {active ? "Exit Mentor Mode" : "Mentor Mode"}
      </button>

      <AnimatePresence>
        {active && (
          <motion.div
            key="mentor-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            style={{
              position: "fixed",
              top: 76,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 120,
              background: "#000000",
              overflowY: "auto",
            }}
          >
            <div style={{ maxWidth: 1040, margin: "0 auto", padding: "56px 40px 96px" }}>
              {/* Header */}
              <p
                style={{
                  fontSize: 10,
                  letterSpacing: 4,
                  color: "#E8A0A0",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                  marginBottom: 10,
                }}
              >
                Mentor Mode
              </p>
              <h2
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 30,
                  fontWeight: 500,
                  color: "#F5F0F0",
                  marginBottom: 6,
                }}
              >
                Student Journals
              </h2>
              <p
                style={{
                  fontSize: 12,
                  color: "rgba(245,240,240,0.45)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                  marginBottom: 40,
                }}
              >
                {selected
                  ? `Reviewing ${selected.discordUsername}`
                  : "Select a student to review their journal."}
              </p>

              <div
                style={{
                  display: "flex",
                  justifyContent: selected ? "flex-start" : "center",
                  alignItems: "flex-start",
                  gap: 36,
                }}
              >
                {/* Roster — slides left via layout when a student is picked. */}
                <motion.div
                  layout
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    width: selected ? 236 : 440,
                    flex: "0 0 auto",
                    border: "1px solid rgba(232,160,160,0.12)",
                    background: "rgba(232,160,160,0.02)",
                  }}
                >
                  {loading ? (
                    <p style={rosterMuted}>Loading…</p>
                  ) : students.length === 0 ? (
                    <p style={rosterMuted}>No student journals yet.</p>
                  ) : (
                    students.map((s) => {
                      const isSel = s.discordId === selectedId;
                      return (
                        <button
                          key={s.discordId}
                          type="button"
                          onClick={() => setSelectedId(s.discordId)}
                          style={{
                            display: "flex",
                            width: "100%",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "14px 18px",
                            background: isSel
                              ? "rgba(232,160,160,0.08)"
                              : "transparent",
                            border: "none",
                            borderLeft: isSel
                              ? "2px solid #E8A0A0"
                              : "2px solid transparent",
                            borderBottom: "1px solid rgba(232,160,160,0.08)",
                            color: isSel ? "#F5F0F0" : "rgba(245,240,240,0.7)",
                            fontFamily: "Georgia, serif",
                            fontSize: 13,
                            letterSpacing: 1,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.discordUsername}
                          </span>
                          <span
                            style={{
                              flex: "0 0 auto",
                              fontSize: 10,
                              color: "rgba(232,160,160,0.6)",
                            }}
                          >
                            {s.entries.length}
                          </span>
                        </button>
                      );
                    })
                  )}
                </motion.div>

                {/* Selected student's journal — drawer-opens to the right. */}
                <AnimatePresence mode="wait">
                  {selected && (
                    <motion.div
                      key={selected.discordId}
                      initial={{ opacity: 0, x: -28 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -28 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      style={{ flex: "1 1 auto", maxWidth: 640, minWidth: 0 }}
                    >
                      {selected.entries.length === 0 ? (
                        <p style={rosterMuted}>This student has no entries.</p>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 16,
                          }}
                        >
                          {selected.entries.map((entry) => {
                            const key = `${entry.discordId}:${entry.id}`;
                            const busy = busyKey === key;
                            const draft = drafts[key] ?? "";
                            const dirty =
                              draft.trim() !== (entry.feedback || "").trim();
                            return (
                              <div
                                key={entry.id}
                                style={{
                                  border: "1px solid rgba(232,160,160,0.12)",
                                  background: "rgba(0,0,0,0.5)",
                                  padding: "16px 19px 18px",
                                  fontFamily: "Georgia, serif",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 9,
                                    color: "rgba(245,240,240,0.4)",
                                    letterSpacing: 1,
                                  }}
                                >
                                  {new Date(entry.createdAt).toLocaleString()}
                                </span>
                                <p
                                  style={{
                                    fontSize: 13,
                                    color: "rgba(245,240,240,0.9)",
                                    lineHeight: 1.8,
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                    margin: "10px 0 14px",
                                  }}
                                >
                                  {entry.body}
                                </p>

                                <textarea
                                  placeholder="Feedback on this entry…"
                                  value={draft}
                                  onChange={(e) =>
                                    setDrafts((d) => ({
                                      ...d,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  rows={2}
                                  style={{
                                    width: "100%",
                                    padding: "10px 12px",
                                    background: "rgba(0,0,0,0.4)",
                                    border: "1px solid rgba(232,160,160,0.2)",
                                    color: "#F5F0F0",
                                    fontFamily: "Georgia, serif",
                                    fontSize: 12,
                                    outline: "none",
                                    resize: "vertical",
                                    marginBottom: 10,
                                  }}
                                />
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => saveFeedback(entry)}
                                    disabled={busy || !dirty}
                                    style={{
                                      fontSize: 9,
                                      letterSpacing: 2,
                                      textTransform: "uppercase",
                                      fontFamily: "Georgia, serif",
                                      padding: "8px 16px",
                                      background: "transparent",
                                      border: "1px solid rgba(232,160,160,0.4)",
                                      color: "#E8A0A0",
                                      cursor: busy || !dirty ? "default" : "pointer",
                                      opacity: busy || !dirty ? 0.5 : 1,
                                    }}
                                  >
                                    {busy
                                      ? "Saving…"
                                      : entry.feedback
                                      ? "Update Feedback"
                                      : "Send Feedback"}
                                  </button>
                                  {entry.feedbackAt && !dirty ? (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "rgba(245,240,240,0.4)",
                                      }}
                                    >
                                      Sent{" "}
                                      {new Date(entry.feedbackAt).toLocaleString()}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const rosterMuted: React.CSSProperties = {
  padding: "18px 20px",
  fontSize: 12,
  color: "rgba(245,240,240,0.45)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};
