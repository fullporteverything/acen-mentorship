"use client";

import { useState } from "react";
import SupportLink from "@/components/SupportLink";
import { MAX_TICKET_BODY, supportUrl } from "@/lib/support";

type Result =
  | { kind: "idle" }
  | { kind: "opened"; url: string }
  /** Signed out — the API can't know who to add to the thread. */
  | { kind: "unauthenticated" }
  | { kind: "failed" };

/**
 * Opens a private Discord thread with the admins without the member having to
 * work out who to message. /support is reachable logged-out, so every failure
 * mode here falls back to the plain support link the page already carries.
 */
export default function SupportTicket() {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result>({ kind: "idle" });
  // With NEXT_PUBLIC_SUPPORT_URL unset the support link resolves to this very
  // page — pointing someone back here as the fallback helps nobody.
  const offsiteSupport = supportUrl() !== "/support";

  async function openTicket() {
    setSending(true);
    setResult({ kind: "idle" });
    try {
      const response = await fetch("/api/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (response.status === 401) {
        setResult({ kind: "unauthenticated" });
        return;
      }
      const data = await response.json().catch(() => null);
      // Only ever follow a Discord deep link — the URL is built server-side,
      // and this keeps it that way even if the response is ever proxied.
      const url = typeof data?.url === "string" ? data.url : "";
      if (response.ok && data?.ok && url.startsWith("https://discord.com/channels/")) {
        setResult({ kind: "opened", url });
      } else {
        setResult({ kind: "failed" });
      }
    } catch {
      setResult({ kind: "failed" });
    } finally {
      setSending(false);
    }
  }

  if (result.kind === "opened") {
    return (
      <div style={{ marginTop: 34 }}>
        <p style={kicker}>Ticket opened</p>
        <p style={{ ...note, marginBottom: 14 }}>
          A private thread is waiting for you in Discord.
        </p>
        <a
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#e3c071",
            fontFamily: "Georgia, serif",
            fontSize: 14,
            letterSpacing: 1,
            textDecoration: "none",
            borderBottom: "1px solid rgba(231,192,113,0.4)",
          }}
        >
          Go to your ticket &rarr;
        </a>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 34 }}>
      <p style={kicker}>Open a ticket in Discord</p>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, MAX_TICKET_BODY))}
        placeholder="What do you need help with? (optional)"
        rows={3}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(231,192,113,0.2)",
          color: "#F5F0F0",
          fontFamily: "Georgia, serif",
          fontSize: 13,
          lineHeight: 1.7,
          outline: "none",
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={openTicket}
          disabled={sending}
          style={{
            padding: "11px 22px",
            background: "transparent",
            border: "1px solid rgba(231,192,113,0.45)",
            color: "#e3c071",
            fontFamily: "Georgia, serif",
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
            cursor: sending ? "default" : "pointer",
            opacity: sending ? 0.4 : 1,
          }}
        >
          {sending ? "Opening…" : "Open a ticket"}
        </button>
        <span style={{ ...note, fontSize: 11, margin: 0 }}>
          {body.length}/{MAX_TICKET_BODY}
        </span>
      </div>

      {result.kind === "unauthenticated" && (
        <p style={{ ...note, color: "#E8807A", marginTop: 14 }}>
          Sign in first, then open a ticket — or reach us on Discord directly.{" "}
          {offsiteSupport && <SupportLink />}
        </p>
      )}
      {result.kind === "failed" && (
        <p style={{ ...note, color: "#E8807A", marginTop: 14 }}>
          The ticket couldn&rsquo;t be opened. Message the administrator on
          Discord instead. {offsiteSupport && <SupportLink />}
        </p>
      )}
    </div>
  );
}

const kicker: React.CSSProperties = {
  marginBottom: 14,
  color: "#e3c071",
  fontFamily: "Georgia, serif",
  fontSize: 10,
  letterSpacing: 2.5,
  textTransform: "uppercase",
};

const note: React.CSSProperties = {
  color: "rgba(245,240,240,0.55)",
  fontFamily: "Georgia, serif",
  fontStyle: "italic",
  fontSize: 13,
  lineHeight: 1.7,
};
