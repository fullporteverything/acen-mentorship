"use client";

import { useState } from "react";

/**
 * Discord avatar with a graceful fallback. If `src` is missing or the image
 * fails to load, render a 30px circle showing the user's first initial in the
 * site's pink-red serif style instead of a broken-image glyph.
 */
export default function AvatarImg({
  src,
  name,
}: {
  src?: string | null;
  name?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  const initial = (name?.trim()?.[0] || "?").toUpperCase();

  if (!src || failed) {
    return (
      <span
        aria-label="avatar"
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          border: "1px solid rgba(232,160,160,0.35)",
          background: "rgba(232,160,160,0.08)",
          color: "#E8A0A0",
          fontFamily: "Georgia, serif",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="avatar"
      width={30}
      height={30}
      onError={() => setFailed(true)}
      style={{
        borderRadius: "50%",
        border: "1px solid rgba(232,160,160,0.35)",
      }}
    />
  );
}
