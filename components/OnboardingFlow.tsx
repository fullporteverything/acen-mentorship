"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type IdentityStatus = "pending" | "verified" | "requires_input" | "canceled" | null;

const BURGUNDY = "#E8A0A0";

const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 5,
  color: BURGUNDY,
  textTransform: "uppercase",
  fontFamily: "Georgia, serif",
};

const heading: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', Georgia, serif",
  fontSize: 30,
  fontWeight: 400,
  fontStyle: "italic",
  color: "#F5F0F0",
  letterSpacing: 1,
  lineHeight: 1.3,
};

const body: React.CSSProperties = {
  fontFamily: "Georgia, serif",
  fontSize: 14,
  lineHeight: 1.8,
  color: "rgba(245,240,240,0.62)",
};

const cardShell: React.CSSProperties = {
  position: "relative",
  zIndex: 20,
  width: "100%",
  maxWidth: 620,
  margin: "0 auto",
  padding: "56px 48px",
  background: "#000000",
  border: "1px solid rgba(232,160,160,0.15)",
};

/**
 * Two-step onboarding gate UI (NDA e-signature → Stripe Identity), themed to the
 * dojo. Reversible: this component plus app/onboarding/* and the layout gate can
 * be removed to restore the pre-gate dashboard exactly.
 */
export default function OnboardingFlow({
  operator,
  ndaText,
  ndaSignedCurrent,
  identityRequired,
  identityStatus,
}: {
  operator: string;
  ndaText: string;
  ndaSignedCurrent: boolean;
  identityRequired: boolean;
  identityStatus: IdentityStatus;
}) {
  const router = useRouter();
  // If the NDA is already signed we can only be here because identity is still
  // pending — start on step 2.
  const [step, setStep] = useState<1 | 2>(ndaSignedCurrent ? 2 : 1);

  return (
    <main
      className="scrollable"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "72px 20px",
        background: "#000000",
      }}
    >
      {step === 1 ? (
        <NdaStep
          operator={operator}
          ndaText={ndaText}
          onSigned={() => {
            if (identityRequired) {
              setStep(2);
            } else {
              // Fully onboarded — the /dashboard render will let them through.
              router.replace("/dashboard");
            }
          }}
        />
      ) : (
        <IdentityStep identityStatus={identityStatus} onEnter={() => router.replace("/dashboard")} />
      )}
    </main>
  );
}

function NdaStep({
  operator,
  ndaText,
  onSigned,
}: {
  operator: string;
  ndaText: string;
  onSigned: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [agree, setAgree] = useState(false);
  const [esign, setEsign] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A short NDA might not overflow its box; then there's nothing to scroll and
  // the button would never enable. Treat "not scrollable" as already at the end.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 4) setScrolledToEnd(true);
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setScrolledToEnd(true);
  };

  const nameValid = legalName.trim().length >= 2 && legalName.trim().length <= 120;
  const canSubmit = scrolledToEnd && nameValid && agree && esign && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/sign-nda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalName: legalName.trim(), consentAgree: agree, consentEsign: esign }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not record your signature.");
      }
      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your signature.");
      setSubmitting(false);
    }
  };

  return (
    <div style={cardShell}>
      <p style={label}>Step 1 of 2 &middot; Confidentiality</p>
      <h1 style={{ ...heading, marginTop: 18 }}>Before you enter, a word kept.</h1>
      <p style={{ ...body, marginTop: 16 }}>
        Everything within this dojo is private. Read the agreement below in full, then sign it
        electronically. {operator} is the Provider named in this agreement.
      </p>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          marginTop: 28,
          maxHeight: 320,
          overflowY: "auto",
          padding: "22px 24px",
          border: "1px solid rgba(232,160,160,0.15)",
          background: "rgba(232,160,160,0.02)",
          fontFamily: "Georgia, serif",
          fontSize: 13,
          lineHeight: 1.85,
          color: "rgba(245,240,240,0.72)",
          whiteSpace: "pre-wrap",
        }}
      >
        {ndaText}
      </div>
      {!scrolledToEnd && (
        <p style={{ ...label, marginTop: 12, color: "rgba(232,160,160,0.5)", letterSpacing: 3 }}>
          Scroll to the end to continue
        </p>
      )}

      <div style={{ marginTop: 28 }}>
        <label style={{ ...label, letterSpacing: 3, display: "block", marginBottom: 8 }}>
          Full legal name
        </label>
        <input
          type="text"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          placeholder="Your full legal name"
          maxLength={120}
          style={{
            width: "100%",
            padding: "12px 14px",
            background: "rgba(232,160,160,0.03)",
            border: "1px solid rgba(232,160,160,0.2)",
            color: "#F5F0F0",
            fontFamily: "Georgia, serif",
            fontSize: 14,
            outline: "none",
          }}
        />
      </div>

      <label style={consentRow}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={checkbox} />
        <span style={consentText}>I have read and agree to this confidentiality agreement.</span>
      </label>
      <label style={consentRow}>
        <input type="checkbox" checked={esign} onChange={(e) => setEsign(e.target.checked)} style={checkbox} />
        <span style={consentText}>
          I consent to sign this agreement electronically, with the same force as a handwritten
          signature.
        </span>
      </label>

      {error && (
        <p style={{ ...body, marginTop: 18, color: "#E88" }} role="alert">
          {error}
        </p>
      )}

      <div style={{ marginTop: 30 }}>
        <button
          type="button"
          className="btn-discord"
          onClick={submit}
          disabled={!canSubmit}
          style={{ opacity: canSubmit ? 1 : 0.4, cursor: canSubmit ? "pointer" : "not-allowed" }}
        >
          {submitting ? "Signing..." : "Agree & Sign"}
        </button>
      </div>
    </div>
  );
}

function IdentityStep({
  identityStatus,
  onEnter,
}: {
  identityStatus: IdentityStatus;
  onEnter: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/identity/start", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not start identity verification.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start identity verification.");
      setStarting(false);
    }
  };

  if (identityStatus === "verified") {
    return (
      <div style={cardShell}>
        <p style={label}>Step 2 of 2 &middot; Identity</p>
        <h1 style={{ ...heading, marginTop: 18 }}>You are verified.</h1>
        <p style={{ ...body, marginTop: 16 }}>Your identity has been confirmed. The way is open.</p>
        <div style={{ marginTop: 30 }}>
          <button type="button" className="btn-discord" onClick={onEnter}>
            Enter the Dojo
          </button>
        </div>
      </div>
    );
  }

  const isPending = identityStatus === "pending";
  const failed = identityStatus === "requires_input" || identityStatus === "canceled";

  return (
    <div style={cardShell}>
      <p style={label}>Step 2 of 2 &middot; Identity</p>
      <h1 style={{ ...heading, marginTop: 18 }}>Verify your identity.</h1>
      <p style={{ ...body, marginTop: 16 }}>
        One last threshold. We use Stripe Identity to confirm you are who you say you are. You will be
        taken to Stripe&rsquo;s secure page and returned here when finished.
      </p>

      {isPending && (
        <p style={{ ...body, marginTop: 18, color: "rgba(232,160,160,0.75)" }}>
          Your verification is being reviewed. This can take a moment — refresh this page once
          you&rsquo;ve completed the Stripe steps.
        </p>
      )}
      {failed && (
        <p style={{ ...body, marginTop: 18, color: "#E88" }}>
          Your last verification didn&rsquo;t go through. Please try again.
        </p>
      )}
      {error && (
        <p style={{ ...body, marginTop: 18, color: "#E88" }} role="alert">
          {error}
        </p>
      )}

      <div style={{ marginTop: 30, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn-discord"
          onClick={start}
          disabled={starting}
          style={{ opacity: starting ? 0.5 : 1, cursor: starting ? "not-allowed" : "pointer" }}
        >
          {starting ? "Redirecting..." : failed ? "Try Again" : "Verify Identity"}
        </button>
        {isPending && (
          <button
            type="button"
            className="btn-discord"
            onClick={() => window.location.reload()}
            style={{ borderColor: "rgba(232,160,160,0.25)" }}
          >
            Refresh Status
          </button>
        )}
      </div>
    </div>
  );
}

const consentRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  marginTop: 18,
  cursor: "pointer",
};

const checkbox: React.CSSProperties = {
  marginTop: 3,
  width: 16,
  height: 16,
  accentColor: BURGUNDY,
  flexShrink: 0,
};

const consentText: React.CSSProperties = {
  fontFamily: "Georgia, serif",
  fontSize: 13,
  lineHeight: 1.7,
  color: "rgba(245,240,240,0.7)",
};
