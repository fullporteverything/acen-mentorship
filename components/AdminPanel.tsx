"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LESSONS } from "@/lib/lessons-config";
import VideoUpload from "@/components/VideoUpload";
import VideoLibrary from "@/components/VideoLibrary";
import StudentProgress from "@/components/StudentProgress";
import RetryButton from "@/components/RetryButton";
import {
  loadAdminSecurity,
  type CaptureLogData,
  type SecurityMemberData,
} from "@/lib/admin-security-client";

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

const sectionLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "4px",
  color: "#e3c071",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  marginBottom: "18px",
};

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(231,192,113,0.12)",
  background: "rgba(231,192,113,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};

const mutedItalic: React.CSSProperties = {
  fontSize: "13px",
  color: "rgba(245,240,240,0.58)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(231,192,113,0.2)",
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
  border: "1px solid rgba(231,192,113,0.4)",
  color: "#e3c071",
  cursor: "pointer",
};

const TABS = [
  ["homework", "Homework"],
  ["students", "Students"],
  ["videos", "Videos"],
  ["announcements", "Announcements"],
  ["security", "Security"],
] as const;

type TabId = (typeof TABS)[number][0];

const DEFAULT_TAB: TabId = "homework";

const isTabId = (value: string | null): value is TabId =>
  TABS.some(([id]) => id === value);

/** Shared strip for a write that failed — mirrors the load-error states. */
function WriteError({ children }: { children: React.ReactNode }) {
  return (
    <div className="state-message state-message-error">
      <p>{children}</p>
    </div>
  );
}

/**
 * Inline two-step confirm, matching the lesson/section admin controls: the
 * control is replaced by "delete? yes / no" and reverts itself if ignored.
 */
function ConfirmStrip({
  label = "delete?",
  busy = false,
  onConfirm,
  onCancel,
}: {
  label?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        flex: "0 0 auto",
      }}
    >
      <span style={confirmTextStyle}>{label}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        style={{ ...confirmActionStyle, color: "#E8807A" }}
      >
        {busy ? "…" : "yes"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{ ...confirmActionStyle, color: "rgba(245,240,240,0.5)" }}
      >
        no
      </button>
    </span>
  );
}

/**
 * Holds a pending confirmation for one key at a time and drops it after ~4s, so
 * a half-finished "delete?" never sits armed on screen.
 */
function useConfirm() {
  const [confirming, setConfirming] = useState("");
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(""), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);
  return [confirming, setConfirming] as const;
}

const confirmTextStyle: React.CSSProperties = {
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  color: "rgba(245,240,240,0.65)",
  whiteSpace: "nowrap",
};

/** Every property is set inline so row-level CSS can't restyle the confirm. */
const confirmActionStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontFamily: "Georgia, serif",
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
};

const pendingBadgeStyle: React.CSSProperties = {
  marginLeft: "4px",
  fontSize: "8px",
  letterSpacing: "1px",
  fontFamily: "Georgia, serif",
};

const lessonTitle = (lessonId: string) =>
  LESSONS.find((l) => l.id === lessonId)?.title || lessonId;

/**
 * Href for a stored homework PDF. New submissions store a blob PATHNAME served
 * through the private /api/blob proxy; legacy rows may hold a full public URL.
 */
const blobHref = (value: string) =>
  value.startsWith("http") ? value : `/api/blob/${value}`;

/** Minimal on-theme pulsing skeleton bar used in place of "Loading…" text. */
function SkeletonBar({ width = "140px" }: { width?: string }) {
  return (
    <div
      aria-hidden
      style={{
        width,
        height: "12px",
        borderRadius: "3px",
        background: "rgba(231,192,113,0.08)",
        animation: "dojoPulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

export default function AdminPanel() {
  // The tab lives in the URL, and reading search params suspends on a
  // prerendered shell — so the panel carries its own boundary.
  return (
    <Suspense fallback={<SkeletonBar width="220px" />}>
      <AdminPanelBody />
    </Suspense>
  );
}

function AdminPanelBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = isTabId(tabParam) ? tabParam : DEFAULT_TAB;

  const [logs, setLogs] = useState<CaptureLogData[]>([]);
  const [securityMembers, setSecurityMembers] = useState<SecurityMemberData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resettingMember, setResettingMember] = useState("");
  const [unlockFailed, setUnlockFailed] = useState(false);
  const [confirmingUnlock, setConfirmingUnlock] = useConfirm();
  const [pendingCount, setPendingCount] = useState(0);
  const countedPending = useRef(false);

  /** Deep-linkable tab, so a refresh doesn't dump the admin back on Homework. */
  function selectTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === DEFAULT_TAB) params.delete("tab");
    else params.set("tab", id);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // The Homework tab mounts the queue, which reports its own pending count for
  // free. Landing anywhere else would leave the badge blank, so buy the count
  // with exactly one extra request — never on every tab switch.
  useEffect(() => {
    if (countedPending.current) return;
    countedPending.current = true;
    if (activeTab === "homework") return;
    let cancelled = false;
    fetch("/api/admin/homework")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.submissions)) return;
        setPendingCount(
          (data.submissions as AdminSubmission[]).filter(
            (s) => s.status === "pending"
          ).length
        );
      })
      .catch(() => {
        // A missing badge is not worth an error strip of its own.
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await loadAdminSecurity();
      setLogs(data.logs);
      setSecurityMembers(data.members);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  async function handleUnlock(discordId: string) {
    setResettingMember(discordId);
    setUnlockFailed(false);
    setConfirmingUnlock("");
    try {
      const response = await fetch("/api/admin/unlock-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId }),
      });
      if (response.ok) {
        setSecurityMembers((members) =>
          members.filter((member) => member.discordId !== discordId)
        );
      } else {
        // Leave the row in place — the strikes are still there to clear.
        setUnlockFailed(true);
      }
    } catch {
      setUnlockFailed(true);
    }
    setResettingMember("");
  }

  return (
    <>
      <style>{`@keyframes dojoPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>

      {/* Upload Video */}
      <nav
        aria-label="Admin sections"
        style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "24px" }}
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            aria-pressed={activeTab === id}
            // The superscript alone reads as a bare number, so spell the badge
            // out for anyone not looking at it.
            aria-label={
              id === "homework" && pendingCount > 0
                ? `${label} — ${pendingCount} pending`
                : undefined
            }
            style={{
              ...smallBtn,
              background: activeTab === id ? "#e3c071" : "transparent",
              color: activeTab === id ? "#000" : "#e3c071",
            }}
          >
            {label}
            {id === "homework" && pendingCount > 0 && (
              <sup
                style={{
                  ...pendingBadgeStyle,
                  color: activeTab === id ? "#000" : "#f7e8ac",
                }}
              >
                {pendingCount}
              </sup>
            )}
          </button>
        ))}
        <a href="/dashboard/lessons" style={{ ...smallBtn, textDecoration: "none" }}>
          Curriculum ↗
        </a>
      </nav>

      {activeTab === "videos" && <>
      <VideoUpload />

      {/* Video Library — every uploaded video ID, retrievable after upload */}
      <VideoLibrary />
      </>}

      {/* Homework Auto-Approval */}
      {activeTab === "homework" && <>
      <AutoApproveSection />

      {/* Homework Submissions Queue */}
      <HomeworkQueueSection onPendingCount={setPendingCount} />
      </>}

      {/* Student Progress — manually advance / reset a student's completions */}
      {activeTab === "students" && <StudentProgress />}

      {/* Announcements */}
      {activeTab === "announcements" && <AnnouncementsSection />}

      {activeTab === "security" && <>
      <section style={cardStyle}>
        <p style={sectionLabel}>Security Members</p>
        {loading ? (
          <SkeletonBar width="180px" />
        ) : error ? (
          <div className="state-message state-message-error">
            <p>Couldn&apos;t load security members.</p>
            <RetryButton onRetry={loadSecurity} />
          </div>
        ) : securityMembers.length === 0 ? (
          <p style={mutedItalic}>No members currently have strikes.</p>
        ) : (
          <>
            {unlockFailed && <WriteError>Could not save — try again.</WriteError>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {securityMembers.map((member) => (
                <div key={member.discordId} className="security-member-row">
                  <div>
                    <p>{member.discordUsername}</p>
                    <span>{member.discordId} · {member.strikes}/3 strikes {member.locked ? "· Locked" : ""}</span>
                  </div>
                  {confirmingUnlock === member.discordId ? (
                    <ConfirmStrip
                      label="reset strikes?"
                      busy={resettingMember === member.discordId}
                      onConfirm={() => handleUnlock(member.discordId)}
                      onCancel={() => setConfirmingUnlock("")}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setUnlockFailed(false);
                        setConfirmingUnlock(member.discordId);
                      }}
                      disabled={resettingMember === member.discordId}
                    >
                      {resettingMember === member.discordId ? "Resetting…" : "Reset strikes"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Screen Capture Attempts */}
      <section style={cardStyle}>
        <p style={sectionLabel}>Screen Capture Attempts</p>
        {loading ? (
          <SkeletonBar width="180px" />
        ) : error ? (
          <div className="state-message state-message-error">
            <p>Couldn&apos;t load capture logs.</p>
            <RetryButton onRetry={loadSecurity} />
          </div>
        ) : logs.length === 0 ? (
          <p style={mutedItalic}>No capture attempts recorded.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  padding: "14px 16px",
                  border: "1px solid rgba(231,192,113,0.10)",
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
      </>}

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
  const [saveFailed, setSaveFailed] = useState(false);

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
    setSaveFailed(false);
    setAutoApprove(next); // optimistic
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApprove: next }),
      });
      if (!res.ok) {
        // Reverting silently looked like a stuck switch — say so.
        setAutoApprove(!next);
        setSaveFailed(true);
      }
    } catch {
      setAutoApprove(!next);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Homework Auto-Approval</p>
      {saveFailed && <WriteError>Could not save — try again.</WriteError>}
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
            border: "1px solid rgba(231,192,113,0.4)",
            background: autoApprove
              ? "rgba(231,192,113,0.4)"
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
              background: autoApprove ? "#e3c071" : "rgba(245,240,240,0.5)",
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
            color: autoApprove ? "#e3c071" : "rgba(245,240,240,0.45)",
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

function HomeworkQueueSection({
  onPendingCount,
}: {
  /** Feeds the badge on the Homework tab from the fetch we already make. */
  onPendingCount: (count: number) => void;
}) {
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/admin/homework");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      const list: AdminSubmission[] = Array.isArray(data?.submissions)
        ? data.submissions
        : [];
      setSubmissions(list);
      onPendingCount(list.filter((s) => s.status === "pending").length);
    } catch {
      setError(true);
      setSubmissions([]);
    } finally {
      setLoading(false);
    }
  }, [onPendingCount]);

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
    setReviewFailed(false);
    try {
      const res = await fetch("/api/admin/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discordId: sub.discordId,
          lessonId: sub.lessonId,
          action,
          feedback: feedbacks[key] || "",
        }),
      });
      if (!res.ok) {
        // The row and its typed feedback stay put so the click can be repeated.
        setReviewFailed(true);
        return;
      }
      await load();
    } catch {
      setReviewFailed(true);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Homework Submissions Queue</p>
      {loading ? (
        <SkeletonBar width="200px" />
      ) : error ? (
        <div className="state-message state-message-error">
          <p>Couldn&apos;t load submissions.</p>
          <RetryButton onRetry={load} />
        </div>
      ) : pending.length === 0 ? (
        <div className="state-message"><p>No pending submissions.</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {reviewFailed && <WriteError>Could not save — try again.</WriteError>}
          {pending.map((sub) => {
            const key = `${sub.discordId}:${sub.lessonId}`;
            const busy = busyKey === key;
            return (
              <div
                key={key}
                style={{
                  padding: "16px 18px",
                  border: "1px solid rgba(231,192,113,0.12)",
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
                  href={blobHref(sub.blobUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    fontSize: "12px",
                    color: "#e3c071",
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
  const [error, setError] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [confirmingId, setConfirmingId] = useConfirm();

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/admin/announcements");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setAnnouncements(
        Array.isArray(data?.announcements) ? data.announcements : []
      );
    } catch {
      setError(true);
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
    setWriteFailed(false);
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
      } else {
        // Keep the typed draft — clearing it would lose the announcement.
        setWriteFailed(true);
      }
    } catch {
      setWriteFailed(true);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setRemovingId(id);
    setWriteFailed(false);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setWriteFailed(true);
        return;
      }
      setConfirmingId("");
      await load();
    } catch {
      setWriteFailed(true);
    } finally {
      setRemovingId("");
    }
  }

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Announcements</p>

      {writeFailed && <WriteError>Could not save — try again.</WriteError>}

      {loading ? (
        <SkeletonBar width="160px" />
      ) : error ? (
        <div className="state-message state-message-error">
          <p>Couldn&apos;t load announcements.</p>
          <RetryButton onRetry={load} />
        </div>
      ) : announcements.length === 0 ? (
        <div className="state-message"><p>No announcements yet.</p></div>
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
                borderLeft: "3px solid #e3c071",
                background: "rgba(231,192,113,0.06)",
                fontFamily: "Georgia, serif",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "13px", color: "#e3c071", marginBottom: "4px" }}>
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
              {confirmingId === a.id ? (
                <ConfirmStrip
                  busy={removingId === a.id}
                  onConfirm={() => remove(a.id)}
                  onCancel={() => setConfirmingId("")}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setWriteFailed(false);
                    setConfirmingId(a.id);
                  }}
                  style={{
                    ...smallBtn,
                    flex: "0 0 auto",
                    borderColor: "rgba(232,128,122,0.5)",
                    color: "#E8807A",
                  }}
                >
                  Delete
                </button>
              )}
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
