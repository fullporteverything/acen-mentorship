"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * Sitewide Discord profile card — a centered modal surfaced by clicking the
 * user in TopNav. Renders the member's Discord banner, avatar (+ animated
 * decoration), name, and an equippable ambient "effect" (sakura / ember / Φ)
 * that persists via the /api/profile/effect endpoint.
 *
 * Sits at z-index 450 — deliberately BELOW SiteMeditation (500) so the idle
 * stillness overlay still wins if the member walks away with the card open.
 */

export type ProfileEffect = "none" | "sakura" | "ember" | "phi";

export interface ProfileCardProps {
  discordId?: string;
  name?: string;
  image?: string;
  avatarHash?: string;
  bannerHash?: string;
  /** Discord accent colour as an integer RGB value. */
  accentColor?: number;
  decorationAsset?: string;
  onClose: () => void;
}

const CARD_WIDTH = 340;
const BANNER_HEIGHT = 120;
const AVATAR_SIZE = 96;

const EFFECTS: { key: ProfileEffect; label: string }[] = [
  { key: "none", label: "None" },
  { key: "sakura", label: "Sakura" },
  { key: "ember", label: "Ember" },
  { key: "phi", label: "Φ" },
];

function cdnExt(hash?: string): "gif" | "png" {
  return hash?.startsWith("a_") ? "gif" : "png";
}

function avatarUrl(
  discordId?: string,
  avatarHash?: string,
  image?: string,
): string | undefined {
  if (discordId && avatarHash) {
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${cdnExt(
      avatarHash,
    )}?size=128`;
  }
  return image || undefined;
}

function bannerUrl(discordId?: string, bannerHash?: string): string | null {
  if (discordId && bannerHash) {
    return `https://cdn.discordapp.com/banners/${discordId}/${bannerHash}.${cdnExt(
      bannerHash,
    )}?size=600`;
  }
  return null;
}

function decorationUrl(asset?: string): string | null {
  if (!asset) return null;
  return `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=160&passthrough=true`;
}

export default function ProfileCard({
  discordId,
  name,
  image,
  avatarHash,
  bannerHash,
  accentColor,
  decorationAsset,
  onClose,
}: ProfileCardProps) {
  const [effect, setEffect] = useState<ProfileEffect>("none");
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the currently-equipped effect on mount.
  useEffect(() => {
    let alive = true;
    fetch("/api/profile/effect")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data && typeof data.effect === "string") {
          setEffect(data.effect as ProfileEffect);
        }
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      alive = false;
    };
  }, []);

  const applyEffect = (next: ProfileEffect) => {
    if (next === effect || saving) return;
    const prev = effect;
    setEffect(next); // optimistic
    setSaving(true);
    fetch("/api/profile/effect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effect: next }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("save failed");
      })
      .catch(() => setEffect(prev)) // revert silently
      .finally(() => setSaving(false));
  };

  const avatar = avatarUrl(discordId, avatarHash, image);
  const banner = bannerUrl(discordId, bannerHash);
  const decoration = decorationUrl(decorationAsset);
  const initial = (name?.trim()?.[0] || "?").toUpperCase();

  let bannerBackground: string;
  if (banner) {
    bannerBackground = `center / cover no-repeat url(${banner})`;
  } else if (typeof accentColor === "number") {
    bannerBackground = `#${accentColor.toString(16).padStart(6, "0")}`;
  } else {
    bannerBackground =
      "linear-gradient(135deg, #2a1216 0%, #4a1e24 55%, #1a0d10 100%)";
  }

  return (
    <motion.div
      key="profile-card-overlay"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 450,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <motion.div
        role="dialog"
        aria-label={name ? `${name} profile` : "Member profile"}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: "relative",
          width: CARD_WIDTH,
          maxWidth: "calc(100vw - 32px)",
          background: "#000",
          border: "1px solid rgba(232,160,160,0.2)",
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)",
        }}
      >
        <EffectStyles />

        {/* Ambient effect layer — over the card, never intercepts clicks. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <EffectLayer effect={effect} />
        </div>

        {/* Content sits above the effect layer. */}
        <div style={{ position: "relative", zIndex: 3 }}>
          {/* Banner */}
          <div
            style={{
              height: BANNER_HEIGHT,
              background: bannerBackground,
              backgroundColor: banner ? "#140a0c" : undefined,
            }}
          />

          {/* Avatar + decoration */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: -AVATAR_SIZE / 2,
            }}
          >
            <div
              style={{
                position: "relative",
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
              }}
            >
              {avatar && !avatarFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar}
                  alt={name ? `${name} avatar` : "avatar"}
                  width={AVATAR_SIZE}
                  height={AVATAR_SIZE}
                  onError={() => setAvatarFailed(true)}
                  style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid #000",
                    background: "#140a0c",
                    display: "block",
                  }}
                />
              ) : (
                <span
                  aria-label="avatar"
                  style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: "50%",
                    border: "2px solid #000",
                    outline: "1px solid rgba(232,160,160,0.35)",
                    background: "rgba(232,160,160,0.08)",
                    color: "#E8A0A0",
                    fontFamily: "'Cormorant Garamond', Georgia, serif",
                    fontSize: 40,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  {initial}
                </span>
              )}

              {decoration ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={decoration}
                  alt=""
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    width: AVATAR_SIZE * 1.2,
                    height: AVATAR_SIZE * 1.2,
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </div>
          </div>

          {/* Name + label */}
          <div style={{ textAlign: "center", padding: "14px 24px 0" }}>
            <div
              style={{
                fontFamily: "'Cormorant Garamond', Georgia, serif",
                fontSize: 22,
                color: "#F5F0F0",
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name || "Member"}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 9,
                letterSpacing: 3,
                color: "rgba(232,160,160,0.6)",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
              }}
            >
              Dojo Member
            </div>
          </div>

          {/* Thin burgundy rule */}
          <div
            style={{
              height: 1,
              margin: "16px 24px 0",
              background:
                "linear-gradient(90deg, rgba(232,160,160,0) 0%, rgba(232,160,160,0.3) 50%, rgba(232,160,160,0) 100%)",
            }}
          />

          {/* Effect picker */}
          <div style={{ padding: "16px 20px 20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: 3,
                  color: "rgba(245,240,240,0.4)",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                }}
              >
                Aura
              </span>
              {saving ? (
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: 2,
                    color: "rgba(232,160,160,0.5)",
                    textTransform: "uppercase",
                    fontFamily: "Georgia, serif",
                    animation: "profileShimmer 1.2s ease-in-out infinite",
                  }}
                >
                  saving…
                </span>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {EFFECTS.map(({ key, label }) => {
                const active = effect === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyEffect(key)}
                    aria-pressed={active}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 4px",
                      background: active
                        ? "rgba(232,160,160,0.1)"
                        : "transparent",
                      border: active
                        ? "1px solid rgba(232,160,160,0.45)"
                        : "1px solid rgba(232,160,160,0.15)",
                      borderRadius: 8,
                      cursor: "pointer",
                      transition:
                        "background 0.2s, border-color 0.2s, color 0.2s",
                    }}
                  >
                    <SwatchGlyph effect={key} />
                    <span
                      style={{
                        fontSize: 8,
                        letterSpacing: 1.5,
                        color: active
                          ? "#E8A0A0"
                          : "rgba(245,240,240,0.5)",
                        textTransform: "uppercase",
                        fontFamily: "Georgia, serif",
                      }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---- Effect rendering ------------------------------------------------- */

/** Deterministic per-index pseudo-spread in [0,1) — no Math.random. */
function spread(i: number, salt: number): number {
  const v = Math.sin((i + 1) * salt) * 43758.5453;
  return v - Math.floor(v);
}

function EffectLayer({ effect }: { effect: ProfileEffect }) {
  if (effect === "sakura") {
    return (
      <>
        {Array.from({ length: 12 }).map((_, i) => {
          const left = spread(i, 12.9898) * 100;
          const duration = 5 + spread(i, 78.233) * 4;
          const delay = -spread(i, 39.425) * duration;
          const size = 4 + Math.round(spread(i, 15.13) * 3);
          return (
            <span
              key={i}
              style={{
                position: "absolute",
                top: -12,
                left: `${left}%`,
                width: size,
                height: size,
                borderRadius: "60% 60% 60% 0",
                background: "#F0B0B0",
                opacity: 0.75,
                animation: `profileSakura ${duration}s linear ${delay}s infinite`,
              }}
            />
          );
        })}
      </>
    );
  }

  if (effect === "ember") {
    return (
      <>
        {Array.from({ length: 10 }).map((_, i) => {
          const left = spread(i, 21.71) * 100;
          const duration = 3.5 + spread(i, 58.11) * 3;
          const delay = -spread(i, 9.71) * duration;
          const size = 2 + Math.round(spread(i, 33.7) * 3);
          return (
            <span
              key={i}
              style={{
                position: "absolute",
                bottom: -8,
                left: `${left}%`,
                width: size,
                height: size,
                borderRadius: "50%",
                background: "rgba(232,128,122,0.9)",
                boxShadow: "0 0 6px rgba(232,128,122,0.6)",
                animation: `profileEmber ${duration}s ease-out ${delay}s infinite`,
              }}
            />
          );
        })}
      </>
    );
  }

  if (effect === "phi") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 220,
            lineHeight: 1,
            color: "rgba(232,160,160,0.08)",
            animation: "profilePhi 3.6s ease-in-out infinite",
          }}
        >
          Φ
        </span>
      </div>
    );
  }

  return null;
}

/** Tiny preview glyph shown inside each picker swatch. */
function SwatchGlyph({ effect }: { effect: ProfileEffect }) {
  const base: React.CSSProperties = {
    width: 14,
    height: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  if (effect === "sakura") {
    return (
      <span
        style={{
          ...base,
          borderRadius: "60% 60% 60% 0",
          width: 10,
          height: 10,
          background: "#F0B0B0",
        }}
      />
    );
  }
  if (effect === "ember") {
    return (
      <span
        style={{
          ...base,
          borderRadius: "50%",
          width: 9,
          height: 9,
          background: "rgba(232,128,122,0.9)",
          boxShadow: "0 0 5px rgba(232,128,122,0.7)",
        }}
      />
    );
  }
  if (effect === "phi") {
    return (
      <span
        style={{
          ...base,
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 15,
          color: "#E8A0A0",
          lineHeight: 1,
        }}
      >
        Φ
      </span>
    );
  }
  // none
  return (
    <span
      style={{
        ...base,
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: "1px solid rgba(245,240,240,0.35)",
      }}
    />
  );
}

/** Keyframes for the ambient effects + the saving shimmer. */
function EffectStyles() {
  return (
    <style>{`
      @keyframes profileSakura {
        0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
        10%  { opacity: 0.75; }
        50%  { transform: translateY(120px) translateX(10px) rotate(180deg); }
        90%  { opacity: 0.75; }
        100% { transform: translateY(240px) translateX(-6px) rotate(360deg); opacity: 0; }
      }
      @keyframes profileEmber {
        0%   { transform: translateY(0) scale(1); opacity: 0; }
        15%  { opacity: 0.9; }
        100% { transform: translateY(-140px) scale(0.4); opacity: 0; }
      }
      @keyframes profilePhi {
        0%, 100% { opacity: 0.05; transform: scale(1); }
        50%      { opacity: 0.14; transform: scale(1.03); }
      }
      @keyframes profileShimmer {
        0%, 100% { opacity: 0.35; }
        50%      { opacity: 0.8; }
      }
    `}</style>
  );
}
