"use client";

import { useEffect, useState } from "react";

interface VpnGuardProps {
  children: React.ReactNode;
}

/**
 * Blocks access when the request appears to originate from a VPN / proxy /
 * datacenter IP. The determination is made server-side (/api/security/check-ip);
 * this component just renders the gate. Falls open on lookup failure.
 */
export default function VpnGuard({ children }: VpnGuardProps) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/security/check-ip")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setBlocked(data?.blocked === true);
      })
      .catch(() => {
        // Fail open — never lock out a legitimate member on a network error.
        if (!cancelled) setBlocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            color: "#E8A0A0",
            textTransform: "uppercase",
            letterSpacing: "6px",
            fontSize: "clamp(20px, 4vw, 34px)",
            fontWeight: 400,
            marginBottom: "20px",
          }}
        >
          Access Denied
        </h1>
        <div
          style={{
            width: "40px",
            height: "1px",
            background:
              "linear-gradient(90deg, transparent, #E8A0A0, transparent)",
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
      </div>
    );
  }

  return <>{children}</>;
}
