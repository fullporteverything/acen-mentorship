"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import RetryButton from "@/components/RetryButton";

/**
 * One live seat, as the admin panel needs it. This is the exact shape
 * /api/admin/sessions returns — the route imports this type (type-only, so
 * nothing from this client module reaches the server bundle) precisely so the
 * projection there and the rendering here cannot drift apart.
 *
 * `fingerprint` arrives already truncated by the route; there is no full hash
 * on this side of the wire to leak.
 */
export interface AdminSessionRow {
  sessionId: string;
  discordId: string;
  displayName: string;
  country: string | null;
  ip: string | null;
  fingerprint: string | null;
  lastSeenAt: string;
}

/** Half the idle window — a seat can never look live for a whole miss. */
const POLL_MS = 30_000;
/** An armed "end sessions" disarms itself, like every other confirm here. */
const CONFIRM_MS = 4000;

const cardStyle: React.CSSProperties = {
  padding: "28px 32px",
  border: "1px solid rgba(231,192,113,0.12)",
  background: "rgba(231,192,113,0.02)",
  maxWidth: "760px",
  marginBottom: "40px",
};

const sectionLabel: React.CSSProperties = {
  fontSize: "10px",
  letterSpacing: "4px",
  color: "#e3c071",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  marginBottom: "18px",
};

const mutedItalic: React.CSSProperties = {
  fontSize: "13px",
  color: "rgba(245,240,240,0.58)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
  padding: "14px 16px",
  border: "1px solid rgba(231,192,113,0.10)",
  background: "rgba(0,0,0,0.25)",
  fontFamily: "Georgia, serif",
};

const metaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "6px",
  fontSize: "11px",
  color: "rgba(245,240,240,0.45)",
  fontFamily: "Georgia, serif",
};

const kickButtonStyle: React.CSSProperties = {
  flex: "0 0 auto",
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  padding: "6px 12px",
  background: "transparent",
  border: "1px solid rgba(232,128,122,0.35)",
  color: "rgba(232,128,122,0.85)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const confirmTextStyle: React.CSSProperties = {
  fontSize: "9px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
  color: "rgba(245,240,240,0.65)",
  whiteSpace: "nowrap",
};

/** Every property inline, so nothing in a row can restyle the confirm. */
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

/** The masked address reads as text until you ask for the rest of it. */
const ipButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  borderBottom: "1px dotted rgba(231,192,113,0.35)",
  padding: 0,
  fontFamily: "Georgia, serif",
  fontSize: "11px",
  color: "rgba(245,240,240,0.45)",
  cursor: "pointer",
};

/**
 * Blank the host part of the address.
 *
 * The admin needs the IP; the room the admin is sitting in does not. This
 * panel gets left open on a second monitor and screen-shared during lessons,
 * and a member's home IP is their approximate street. So the network is shown
 * at rest — enough to see that two seats are nowhere near each other — and the
 * host is one deliberate click away.
 */
function maskIp(ip: string): string {
  if (ip.includes(":")) {
    const groups = ip.split(":");
    return `${groups.slice(0, 3).join(":")}:••••`;
  }
  const octets = ip.split(".");
  if (octets.length === 4) return `${octets.slice(0, 3).join(".")}.•••`;
  return "•••";
}

/** "42s ago". `now` is already corrected onto the server's clock. */
function lastSeenLabel(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "last seen unknown";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Separator() {
  return <span aria-hidden style={{ color: "rgba(245,240,240,0.2)" }}>·</span>;
}

/**
 * Live single-seat monitor.
 *
 * Three states are told apart on purpose. An empty list and a failed load look
 * identical if you let them — and "nobody is online" is a claim this panel must
 * never make when what actually happened is that it could not ask. A refresh
 * that fails while rows are already on screen keeps the rows and says they are
 * stale, rather than blanking a list the admin was reading.
 */
export default function SessionAdmin() {
  const [rows, setRows] = useState<AdminSessionRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [kickFailed, setKickFailed] = useState(false);
  const [confirming, setConfirming] = useState("");
  const [revoking, setRevoking] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  /** localClock - serverClock, so "last seen" survives a wrong laptop clock. */
  const [skew, setSkew] = useState(0);

  const aliveRef = useRef(true);
  const rowsRef = useRef<AdminSessionRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/sessions", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      if (!Array.isArray(data?.sessions)) throw new Error("unexpected shape");
      if (!aliveRef.current) return;
      if (typeof data.serverNow === "string") {
        const serverNow = Date.parse(data.serverNow);
        if (!Number.isNaN(serverNow)) setSkew(Date.now() - serverNow);
      }
      rowsRef.current = data.sessions as AdminSessionRow[];
      setRows(rowsRef.current);
      setLoadFailed(false);
      setRefreshFailed(false);
      setNow(Date.now());
    } catch {
      if (!aliveRef.current) return;
      // Never downgrade a list we already have into a lie about it.
      if (rowsRef.current) setRefreshFailed(true);
      else setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    // The list refreshes on the half-minute; the ages tick every second.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      aliveRef.current = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(""), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function handleKick(discordId: string) {
    setConfirming("");
    setKickFailed(false);
    setRevoking(discordId);
    try {
      const response = await fetch("/api/admin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      // Don't guess at the new list — ask, so what's on screen stays true.
      await load();
    } catch {
      if (aliveRef.current) setKickFailed(true);
    } finally {
      if (aliveRef.current) setRevoking("");
    }
  }

  const serverNow = now - skew;

  return (
    <section style={cardStyle}>
      <p style={sectionLabel}>Live Sessions</p>

      {rows === null && !loadFailed ? (
        <div
          aria-label="Loading live sessions"
          role="status"
          style={{
            width: "180px",
            height: "12px",
            borderRadius: "3px",
            background: "rgba(231,192,113,0.08)",
            animation: "dojoPulse 1.4s ease-in-out infinite",
          }}
        />
      ) : loadFailed ? (
        <div className="state-message state-message-error">
          <p>
            Couldn&apos;t load live sessions — this is not the same as nobody
            being online.
          </p>
          <RetryButton onRetry={() => void load()} />
        </div>
      ) : (
        <>
          {refreshFailed && (
            <div className="state-message state-message-error">
              <p>Couldn&apos;t refresh — the list below may be out of date.</p>
              <RetryButton onRetry={() => void load()} />
            </div>
          )}
          {kickFailed && (
            <div className="state-message state-message-error">
              <p>Could not end that member&apos;s sessions — try again.</p>
            </div>
          )}
          {rows && rows.length === 0 ? (
            <p style={mutedItalic}>No active sessions.</p>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {(rows ?? []).map((session) => {
              const isRevealed = Boolean(revealed[session.sessionId]);
              const busy = revoking === session.discordId;
              return (
                <div key={session.sessionId} style={rowStyle}>
                  <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                    <p
                      style={{
                        fontSize: "13px",
                        color: "#F5F0F0",
                        marginBottom: "4px",
                      }}
                    >
                      {session.displayName || "Unknown member"}
                      <span style={{ color: "rgba(245,240,240,0.35)" }}>
                        {" "}
                        · {session.discordId}
                      </span>
                    </p>
                    <div style={metaStyle}>
                      <span>{session.country || "location unknown"}</span>
                      <Separator />
                      {session.ip ? (
                        <button
                          type="button"
                          onClick={() =>
                            setRevealed((current) => ({
                              ...current,
                              [session.sessionId]: !current[session.sessionId],
                            }))
                          }
                          aria-label={
                            isRevealed
                              ? `Hide full IP address for ${session.displayName}`
                              : `Reveal full IP address for ${session.displayName}`
                          }
                          title={isRevealed ? "Hide full IP" : "Reveal full IP"}
                          style={ipButtonStyle}
                        >
                          {isRevealed ? session.ip : maskIp(session.ip)}
                        </button>
                      ) : (
                        <span>IP unknown</span>
                      )}
                      <Separator />
                      <span>
                        device{" "}
                        {session.fingerprint
                          ? `${session.fingerprint}…`
                          : "unknown"}
                      </span>
                      <Separator />
                      <span style={{ color: "rgba(247,232,172,0.55)" }}>
                        {lastSeenLabel(session.lastSeenAt, serverNow)}
                      </span>
                    </div>
                  </div>

                  {confirming === session.sessionId ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        flex: "0 0 auto",
                      }}
                    >
                      <span style={confirmTextStyle}>end sessions?</span>
                      <button
                        type="button"
                        onClick={() => void handleKick(session.discordId)}
                        disabled={busy}
                        style={{ ...confirmActionStyle, color: "#E8807A" }}
                      >
                        {busy ? "…" : "yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming("")}
                        disabled={busy}
                        style={{
                          ...confirmActionStyle,
                          color: "rgba(245,240,240,0.5)",
                        }}
                      >
                        no
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setKickFailed(false);
                        setConfirming(session.sessionId);
                      }}
                      disabled={busy}
                      aria-label={`End sessions for ${session.displayName}`}
                      style={kickButtonStyle}
                    >
                      {busy ? "Ending…" : "End sessions"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </>
      )}
    </section>
  );
}
