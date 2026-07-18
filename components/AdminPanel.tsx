"use client";

import { useEffect, useState } from "react";

interface CaptureLog {
  discordId?: string;
  discordUsername?: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
}

const sectionLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "4px",
  color: "#C41818",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  marginBottom: "18px",
};

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(196,24,24,0.12)",
  background: "rgba(196,24,24,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};

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
    // Release any active client-side screen lock in this session too.
    if (typeof window !== "undefined") {
      (window as any).__dojoAdminUnlock = true;
    }
    setUnlockState("done");
  }

  return (
    <>
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
                  border: "1px solid rgba(196,24,24,0.10)",
                  background: "rgba(0,0,0,0.25)",
                  fontFamily: "Georgia, serif",
                }}
              >
                <p style={{ fontSize: "13px", color: "#F0EDE6", marginBottom: "4px" }}>
                  {log.discordUsername || "Unknown member"}
                  {log.discordId ? (
                    <span style={{ color: "rgba(240,237,230,0.35)" }}>
                      {" "}
                      · {log.discordId}
                    </span>
                  ) : null}
                </p>
                <p style={{ fontSize: "11px", color: "rgba(240,237,230,0.45)" }}>
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

const mutedItalic: React.CSSProperties = {
  fontSize: "13px",
  color: "rgba(240,237,230,0.45)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};
