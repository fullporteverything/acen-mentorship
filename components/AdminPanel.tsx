"use client";

import { useCallback, useEffect, useState } from "react";
import { LESSONS } from "@/lib/lessons-config";
import VideoUpload from "@/components/VideoUpload";

interface CaptureLog {
  discordId?: string;
  discordUsername?: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
}

interface AdminSubmission {
  discordId: string;
  discordUsername: string;
  lessonId: string;
  blobUrl: string;
  fileName: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  feedback: string;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

interface AdminJournalEntry {
  id: string;
  discordId: string;
  discordUsername: string;
  body: string;
  createdAt: string;
  feedback?: string;
  feedbackAt?: string;
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(232,160,160,0.2)",
  color: "#F5F0F0",
  fontFamily: "Georgia, serif",
  fontSize: "13px",
  outline: "none",
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

const lessonTitle = (lessonId: string) =>
  LESSONS.find((l) => l.id === lessonId)?.title || lessonId;

export default function AdminPanel() {
  const [logs, setLogs] = useState<CaptureLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlockState, setUnlockState] = useState<"idle" | "working" | "done">(
    "idle"
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/capture-logs")
      .then((res) => (res.ok ? res.json() : { logs: [] }))
      .then((data) => {
        if (!cancelled) setLogs(Array.isArray(data?.logs) ? data.logs : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnlock() {
    setUnlockState("working");
    try {
      await fetch("/api/admin/unlock-all", { method: "POST" });
    } catch {
      // ignore — still flip the client flag below
    }
    if (typeof window !== "undefined") {
      (window as any).__dojoAdminUnlock = true;
    }
    setUnlockState("done");
  }

  return (
    <>
      {/* Upload Video */}
      <VideoUpload />

      {/* Homework Auto-Approval */}
      <AutoApproveSection />

      {/* Homework Submissions Queue */}
      <HomeworkQueueSection />

      {/* Member Journals — per-entry mentor feedback */}
      <JournalFeedbackSection />

      {/* Announcements */}
      <AnnouncementsSection />

      {/* Screen Capture Attempts */}
      <section style={cardStyle}>
        <p style={sectionLabel}>Screen Capture Attempts</p>
        {loading ? (
          <p style={mutedItalic}>Loading…</p>
        ) : logs.length === 0 ? (
          <p style={mutedItalic}>No capture attempts recorded.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 16px",
                  border: "1px solid rgba(232,160,160,0.10)",
                  background: "rgba(0,0,0,0.25)",
                  fontFamily: "Georgia, serif",
                }}
              >
                <p style={{ fontSize: "13px", color: "#F5F0F0", marginBottom: "4px" }}>
                  {log.discordUsername || "Unknown member"}
                  {log.discordId ? (
                    <span style={{ color: "rgba(245,240,240,0.35)" }}>
                      {" "}
                      · {log.discordId}
                    </span>
                  ) : null}
                </p>
                <p style={{ fontSize: "11px", color: "rgba(245,240,240,0.45)" }}>
                  {log.timestamp}
                  {log.ip ? ` · ${log.ip}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Unlock Screen Lock */}
      <section style={cardStyle}>
        <p style={sectionLabel}>Unlock Screen Lock</p>
        <p style={{ ...mutedItalic, marginBottom: "20px" }}>
          Releases the screen-recording lock for the current session.
        </p>
        <button
          type="button"
          onClick={handleUnlock}
          disabled={unlockState === "working"}
          className="btn-discord"
          style={{ opacity: unlockState === "working" ? 0.6 : 1 }}
        >
          {unlockState === "done"
            ? "Unlocked"
            : unlockState === "working"
            ? "Unlocking…"
            : "Unlock Screen Lock"}
        </button>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Auto-approve toggle
// ---------------------------------------------------------------------------

function AutoApproveSection() {
  const [autoApprove, setAutoApprove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings")
      .then((res) => (res.ok ? res.json() : { autoApprove: false }))
      .then((data) => {
        if (!cancelled) setAutoApprove(Boolean(data?.autoApprove));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    const next = !autoApprove;
    setSaving(true);
    setAutoApprove(next); // optimistic
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApprove: next }),
      });
      if (!res.ok) setAutoApprove(!next); // revert on failure
    } catch {
      setAutoApprove(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Homework Auto-Approval</p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          marginBottom: "16px",
        }}
      >
        <button
          type="button"
          role="switch"
          aria-checked={autoApprove}
          onClick={toggle}
          disabled={loading || saving}
          style={{
            position: "relative",
            width: "48px",
            height: "24px",
            borderRadius: "12px",
            border: "1px solid rgba(232,160,160,0.4)",
            background: autoApprove
              ? "rgba(232,160,160,0.4)"
              : "rgba(0,0,0,0.4)",
            cursor: loading || saving ? "default" : "pointer",
            transition: "background 0.25s ease",
            padding: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: "2px",
              left: autoApprove ? "26px" : "2px",
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              background: autoApprove ? "#E8A0A0" : "rgba(245,240,240,0.5)",
              transition: "left 0.25s ease, background 0.25s ease",
            }}
          />
        </button>
        <span
          style={{
            fontSize: "12px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            color: autoApprove ? "#E8A0A0" : "rgba(245,240,240,0.45)",
          }}
        >
          {loading ? "…" : autoApprove ? "On" : "Off"}
        </span>
      </div>
      <p style={mutedItalic}>
        When ON, submitted homework is instantly approved and the next lesson
        unlocks immediately.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Homework submissions queue
// ---------------------------------------------------------------------------

function HomeworkQueueSection() {
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/homework");
      const data = res.ok ? await res.json() : { submissions: [] };
      setSubmissions(
        Array.isArray(data?.submissions) ? data.submissions : []
      );
    } catch {
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pending = submissions.filter((s) => s.status === "pending");

  async function review(
    sub: AdminSubmission,
    action: "approve" | "reject"
  ) {
    const key = `${sub.discordId}:${sub.lessonId}`;
    setBusyKey(key);
    try {
      await fetch("/api/admin/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordId: sub.discordId,
          lessonId: sub.lessonId,
          action,
          feedback: feedbacks[key] || "",
        }),
      });
      await load();
    } catch {
      // ignore
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Homework Submissions Queue</p>
      {loading ? (
        <p style={mutedItalic}>Loading…</p>
      ) : pending.length === 0 ? (
        <p style={mutedItalic}>No pending submissions.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {pending.map((sub) => {
            const key = `${sub.discordId}:${sub.lessonId}`;
            const busy = busyKey === key;
            return (
              <div
                key={key}
                style={{
                  padding: "16px 18px",
                  border: "1px solid rgba(232,160,160,0.12)",
                  background: "rgba(0,0,0,0.25)",
                  fontFamily: "Georgia, serif",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "12px",
                    marginBottom: "10px",
                  }}
                >
                  <p style={{ fontSize: "14px", color: "#F5F0F0" }}>
                    {sub.discordUsername}
                    <span style={{ color: "rgba(245,240,240,0.4)" }}>
                      {" "}
                      · {lessonTitle(sub.lessonId)}
                    </span>
                  </p>
                  <span
                    style={{
                      fontSize: "10px",
                      color: "rgba(245,240,240,0.4)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(sub.submittedAt).toLocaleString()}
                  </span>
                </div>

                <a
                  href={sub.blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    fontSize: "12px",
                    color: "#E8A0A0",
                    letterSpacing: "1px",
                    marginBottom: "14px",
                    textDecoration: "none",
                  }}
                >
                  {sub.fileName} ↗
                </a>

                <input
                  type="text"
                  placeholder="Feedback (optional)"
                  value={feedbacks[key] || ""}
                  onChange={(e) =>
                    setFeedbacks((f) => ({ ...f, [key]: e.target.value }))
                  }
                  style={{ ...inputStyle, marginBottom: "12px" }}
                />

                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => review(sub, "approve")}
                    disabled={busy}
                    style={{ ...smallBtn, opacity: busy ? 0.5 : 1 }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => review(sub, "reject")}
                    disabled={busy}
                    style={{
                      ...smallBtn,
                      borderColor: "rgba(232,128,122,0.5)",
                      color: "#E8807A",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

function AnnouncementsSection() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/announcements");
      const data = res.ok ? await res.json() : { announcements: [] };
      setAnnouncements(
        Array.isArray(data?.announcements) ? data.announcements : []
      );
    } catch {
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      if (res.ok) {
        setTitle("");
        setBody("");
        await load();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await fetch("/api/admin/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch {
      // ignore
    }
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Announcements</p>

      {loading ? (
        <p style={mutedItalic}>Loading…</p>
      ) : announcements.length === 0 ? (
        <p style={{ ...mutedItalic, marginBottom: "20px" }}>
          No announcements yet.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          {announcements.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "16px",
                padding: "14px 16px",
                borderLeft: "3px solid #E8A0A0",
                background: "rgba(232,160,160,0.06)",
                fontFamily: "Georgia, serif",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "13px", color: "#E8A0A0", marginBottom: "4px" }}>
                  {a.title}
                </p>
                <p
                  style={{
                    fontSize: "12px",
                    color: "rgba(245,240,240,0.7)",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {a.body}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(a.id)}
                style={{
                  ...smallBtn,
                  flex: "0 0 auto",
                  borderColor: "rgba(232,128,122,0.5)",
                  color: "#E8807A",
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={post} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <input
          type="text"
          placeholder="Announcement title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
        <textarea
          placeholder="Announcement body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <button
          type="submit"
          disabled={saving || !title.trim() || !body.trim()}
          className="btn-discord"
          style={{
            alignSelf: "flex-start",
            opacity: saving || !title.trim() || !body.trim() ? 0.5 : 1,
          }}
        >
          {saving ? "Posting…" : "Post Announcement"}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Member journals — per-entry mentor feedback
// ---------------------------------------------------------------------------

function JournalFeedbackSection() {
  const [entries, setEntries] = useState<AdminJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/journal-feedback");
      const data = res.ok ? await res.json() : { entries: [] };
      const list: AdminJournalEntry[] = Array.isArray(data?.entries)
        ? data.entries
        : [];
      setEntries(list);
      const map: Record<string, string> = {};
      for (const e of list) map[`${e.discordId}:${e.id}`] = e.feedback || "";
      setDrafts(map);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(entry: AdminJournalEntry) {
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

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Member Journals</p>
      {loading ? (
        <p style={mutedItalic}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={mutedItalic}>No journal entries yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {entries.map((entry) => {
            const key = `${entry.discordId}:${entry.id}`;
            const busy = busyKey === key;
            const draft = drafts[key] ?? "";
            const dirty = draft.trim() !== (entry.feedback || "").trim();
            return (
              <div
                key={key}
                style={{
                  padding: "16px 18px",
                  border: "1px solid rgba(232,160,160,0.12)",
                  background: "rgba(0,0,0,0.25)",
                  fontFamily: "Georgia, serif",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "12px",
                    marginBottom: "10px",
                  }}
                >
                  <p style={{ fontSize: "14px", color: "#F5F0F0" }}>
                    {entry.discordUsername}
                  </p>
                  <span
                    style={{
                      fontSize: "10px",
                      color: "rgba(245,240,240,0.4)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: "13px",
                    color: "rgba(245,240,240,0.8)",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    marginBottom: "14px",
                  }}
                >
                  {entry.body}
                </p>

                <textarea
                  placeholder="Feedback on this entry…"
                  value={draft}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [key]: e.target.value }))
                  }
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical", marginBottom: "10px" }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <button
                    type="button"
                    onClick={() => save(entry)}
                    disabled={busy || !dirty}
                    style={{ ...smallBtn, opacity: busy || !dirty ? 0.5 : 1 }}
                  >
                    {busy
                      ? "Saving…"
                      : entry.feedback
                      ? "Update Feedback"
                      : "Send Feedback"}
                  </button>
                  {entry.feedbackAt && !dirty ? (
                    <span
                      style={{ fontSize: "10px", color: "rgba(245,240,240,0.4)" }}
                    >
                      Sent {new Date(entry.feedbackAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
