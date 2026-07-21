"use client";

import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { createPortal } from "react-dom";
import AvatarImg from "@/components/AvatarImg";
import ProfileCard from "@/components/ProfileCard";

/**
 * Clickable TopNav identity cluster: the member's avatar + username, styled
 * exactly as TopNav rendered them inline, but as a button that toggles the
 * sitewide <ProfileCard> modal.
 */

export interface ProfileTriggerProps {
  discordId?: string;
  name?: string;
  image?: string;
  avatarHash?: string;
  bannerHash?: string;
  accentColor?: number;
  decorationAsset?: string;
}

export default function ProfileTrigger({
  discordId,
  name,
  image,
  avatarHash,
  bannerHash,
  accentColor,
  decorationAsset,
}: ProfileTriggerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={name ? `Open ${name}'s profile` : "Open profile"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          cursor: "pointer",
          minWidth: 0,
          color: "inherit",
          font: "inherit",
        }}
      >
        <AvatarImg src={image} name={name} />
        <span
          className="topnav-username"
          style={{
            fontSize: 11,
            color: "rgba(245,240,240,0.65)",
            fontFamily: "Georgia, serif",
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </button>

      {/* Portal to <body>: the topnav's backdrop-filter makes it the containing
         block for fixed-position descendants, which would trap and clip the
         modal inside the 76px nav strip. The portal escapes it. `open` only
         turns true from a click, so document is always available here. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
        {open && (
          <ProfileCard
            discordId={discordId}
            name={name}
            image={image}
            avatarHash={avatarHash}
            bannerHash={bannerHash}
            accentColor={accentColor}
            decorationAsset={decorationAsset}
            onClose={() => setOpen(false)}
          />
        )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
