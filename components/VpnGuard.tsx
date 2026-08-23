"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SupportLink from "@/components/SupportLink";

interface VpnGuardProps {
  children: React.ReactNode;
}

const CACHE_KEY = "dojo:vpnCheck";
const CACHE_TTL = 30 * 60 * 1000; // re-check at most once every 30 min per browser

/**
 * Blocks access when the request appears to originate from a VPN / proxy /
 * datacenter IP. The determination is made server-side (/api/security/check-ip);
 * this component just renders the gate. Falls open on lookup failure.
 */
export default function VpnGuard({ children }: VpnGuardProps) {
  const [blocked, setBlocked] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const runCheck = useCallback(async (ignoreCache: boolean) => {
    if (ignoreCache) {
      // "Check again" means exactly that — a stale block must not answer for
      // the network the member just switched off.
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        // ignore
      }
    } else {
      // Reuse a recent result so we don't hit the endpoint on every navigation.
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const c = JSON.parse(raw) as { blocked: boolean; at: number };
          if (c && typeof c.at === "number" && Date.now() - c.at < CACHE_TTL) {
            if (live.current) setBlocked(c.blocked === true);
            if (!c.blocked) return;
          }
        }
      } catch {
        // ignore malformed cache
      }
    }

    try {
      const res = await fetch("/api/security/check-ip", { cache: "no-store" });
      const data = await res.json();
      if (!live.current) return;
      // The server-authenticated admin override is explicit and clears any
      // stale client-side block cache; it never creates a capture strike.
      const b = data?.state === "overridden" ? false : data?.blocked === true;
      setBlocked(b);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ blocked: b, at: Date.now() }));
      } catch {
        // ignore
      }
    } catch {
      // Fail open — never lock out a legitimate member on a network error.
      if (live.current) setBlocked(false);
    }
  }, []);

  useEffect(() => {
    void runCheck(false);
  }, [runCheck]);

  async function recheck() {
    setRechecking(true);
    try {
      await runCheck(true);
    } finally {
      if (live.current) setRechecking(false);
    }
  }

  if (blocked) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99999,
          background: "#000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "24px",
          userSelect: "none",
        }}
      >
        <h1
          style={{
            fontFamily: "Georgia, serif",
            color: "#e3c071",
            textTransform: "uppercase",
            letterSpacing: "6px",
            fontSize: "clamp(20px, 4vw, 34px)",
            fontWeight: 400,
            marginBottom: "20px",
          }}
        >
          Network Blocked
        </h1>
        <div
          style={{
            width: "40px",
            height: "1px",
            background:
              "linear-gradient(90deg, transparent, #e3c071, transparent)",
            marginBottom: "20px",
          }}
        />
        <p
          style={{
            fontFamily: "Georgia, serif",
            color: "rgba(245,240,240,0.55)",
            fontStyle: "italic",
            fontSize: "14px",
            letterSpacing: "1px",
            maxWidth: "360px",
            lineHeight: 1.8,
          }}
        >
          VPN or proxy detected. Disable your VPN to continue.
        </p>
        {/* The lookup can't tell a VPN from a relay or a mobile gateway, so
            say so rather than letting an honest member think they're accused
            of hiding something. */}
        <p
          style={{
            marginTop: "14px",
            fontFamily: "Georgia, serif",
            color: "rgba(245,240,240,0.34)",
            fontStyle: "italic",
            fontSize: "12px",
            maxWidth: "380px",
            lineHeight: 1.7,
          }}
        >
          iCloud Private Relay and some carrier networks can trigger this too.
        </p>
        <button
          type="button"
          onClick={recheck}
          disabled={rechecking}
          style={{
            marginTop: "26px",
            padding: "11px 22px",
            background: "transparent",
            border: "1px solid rgba(231,192,113,0.45)",
            color: "#e3c071",
            fontFamily: "Georgia, serif",
            fontSize: "10px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            cursor: rechecking ? "default" : "pointer",
            opacity: rechecking ? 0.4 : 1,
          }}
        >
          {rechecking ? "Checking…" : "Check again"}
        </button>
        <p style={{ marginTop: "20px" }}>
          <SupportLink>Not using a VPN? Get help</SupportLink>
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
