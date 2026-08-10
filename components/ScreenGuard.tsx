"use client";

import { useEffect, useState } from "react";
import SupportLink from "@/components/SupportLink";

interface ScreenGuardProps {
  isAdmin?: boolean;
  initialStrikes?: number;
  initialAcknowledgedStrikes?: number;
  initialLocked?: boolean;
  children: React.ReactNode;
}

const COPY = {
  1: {
    title: "I can see you…",
    line1: "Screen sharing or recording was detected.",
    line2: "Don’t make that mistake again.",
  },
  2: {
    title: "Last chance.",
    line1: "Another screen sharing or recording attempt was detected.",
    line2: "Your next attempt will revoke access to the site.",
  },
  3: {
    title: "Access revoked.",
    line1: "This account was locked after repeated screen sharing or recording attempts.",
    line2: "Contact an administrator to appeal this lockout.",
  },
} as const;

export default function ScreenGuard({
  isAdmin = false,
  initialStrikes = 0,
  initialAcknowledgedStrikes = 0,
  initialLocked = false,
  children,
}: ScreenGuardProps) {
  const [strikes, setStrikes] = useState(Math.min(3, initialStrikes));
  const [warning, setWarning] = useState<0 | 1 | 2 | 3>(
    initialLocked
      ? 3
      : initialStrikes > initialAcknowledgedStrikes
        ? Math.min(3, initialStrikes) as 1 | 2 | 3
        : 0
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isAdmin || !navigator.mediaDevices?.getDisplayMedia) return;
    const md = navigator.mediaDevices;
    const original = md.getDisplayMedia;
    const patched = async (): Promise<MediaStream> => {
      const provisional = Math.min(3, strikes + 1) as 1 | 2 | 3;
      setStrikes(provisional);
      setWarning(provisional);
      setAcknowledged(false);
      fetch("/api/security/log-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timestamp: new Date().toISOString() }),
      })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          if (typeof data?.strikes === "number") {
            const confirmed = Math.min(3, data.strikes) as 1 | 2 | 3;
            setStrikes(confirmed);
            setWarning(confirmed);
          }
        })
        .catch(() => {});
      throw new DOMException("Permission denied", "NotAllowedError");
    };
    md.getDisplayMedia = patched as typeof md.getDisplayMedia;
    return () => { md.getDisplayMedia = original; };
  }, [isAdmin, strikes]);

  async function continueAfterWarning() {
    if (!acknowledged || warning === 3) return;
    setSaving(true);
    try {
      const response = await fetch("/api/security/acknowledge", { method: "POST" });
      if (response.ok) setWarning(0);
    } finally {
      setSaving(false);
    }
  }

  const copy = warning ? COPY[warning] : null;
  return (
    <>
      {children}
      {copy && (
        <div className="security-strike-screen" role="alertdialog" aria-modal="true">
          <div className="security-strike-mark" aria-hidden>警</div>
          <div className="security-strike-box">
            <p className="security-strike-label">
              {warning === 3 ? "Membership security" : `Security warning · Strike ${warning} of 3`}
            </p>
            <h1>{copy.title}</h1>
            <div className="security-strike-divider" />
            <p>{copy.line1}</p>
            <p>{copy.line2}</p>
          </div>
          {warning < 3 ? (
            <div className="security-strike-ack">
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>I acknowledge this warning</span>
              </label>
              <button
                type="button"
                disabled={!acknowledged || saving}
                onClick={continueAfterWarning}
              >
                {saving ? "Saving…" : "Continue"}
              </button>
            </div>
          ) : (
            <p className="security-strike-support">
              <SupportLink>Contact admin support to appeal</SupportLink>
            </p>
          )}
        </div>
      )}
    </>
  );
}
