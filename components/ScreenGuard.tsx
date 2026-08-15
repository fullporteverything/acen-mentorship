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
    title: "Hold there.",
    line1: "Screen capture was blocked.",
    line2: "Recording lesson material ends membership.",
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
    const patched = async (
      ...args: Parameters<typeof original>
    ): Promise<MediaStream> => {
      // Let the browser raise its own picker first. Opening the picker is not
      // an attempt — a member who hits Cancel gets that rejection passed
      // straight back and is never struck for it. Only a RESOLVED promise
      // means a capture actually started, and that is what we punish.
      const stream = await original.call(md, ...args);
      // Capture started: kill every track this instant so not one frame of
      // lesson material is ever readable, then record the strike.
      for (const track of stream.getTracks()) track.stop();

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
      await fetch("/api/security/acknowledge", { method: "POST" });
    } catch {
      // Swallowed deliberately — see below.
    } finally {
      setSaving(false);
      // Dismiss whether or not the POST landed. The strike itself is already
      // recorded server-side, and the next page load re-reads the real
      // acknowledged count — so a dropped request costs us nothing, while
      // holding the overlay open would trap the member behind a z-99999
      // dialog with no way out but a hard reload.
      setWarning(0);
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
              {/* Phone stacking for this row lives in globals.css (≤760px). */}
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <button
                  type="button"
                  disabled={!acknowledged || saving}
                  onClick={continueAfterWarning}
                >
                  {saving ? "Saving…" : "Continue"}
                </button>
                {/* Detection can only see that a capture started, never who
                    started it. Give a wrongly-struck member a way to say so. */}
                <SupportLink>This wasn’t me — get help</SupportLink>
              </div>
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
