"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * SUITE 7 — RIGHT-CLICK GUARD.
 *
 * Suppresses the browser context menu (and the adjacent easy save routes)
 * everywhere behind the login, and tightens further on the Lectures pages
 * where the actual course material lives.
 *
 * ⚠ READ THIS BEFORE TRUSTING IT. This is a DETERRENT, not a protection.
 * Anyone who wants the material can still get it: devtools opens from the
 * menu bar, "view-source:" is a URL, the page HTML is already on their disk,
 * and OBS/QuickTime capture the window without touching the page at all. What
 * this does buy is friction against the casual "save image as / copy all"
 * reflex, and it pairs with ScreenGuard (capture) and StudentWatermark
 * (attribution) rather than replacing either. Do not let it become the reason
 * we skip a real control.
 *
 * Deliberate exemptions — breaking these would make the site hostile:
 *   • Text fields. Right-click in an input/textarea/contenteditable is how
 *     people paste, and how spellcheck is reached. Journal entries, support
 *     tickets and the admin console all depend on it.
 *   • Admins. The console, the debug overlays and ordinary maintenance all
 *     want a real browser. `isAdmin` is decided on the SERVER in the dashboard
 *     layout; nothing here reads it from the client.
 *   • Anything tagged `data-allow-context`, as a per-element escape hatch.
 *
 * Known hole we cannot close: the lesson video is a CROSS-ORIGIN Kinescope
 * iframe. A page cannot install listeners inside another origin's document,
 * so right-click over the player is Kinescope's to handle, not ours.
 */

/** Elements where the native menu must keep working. */
const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-allow-context]';

/** Routes that get the tighter treatment — the Lectures tab. */
const STRICT_PREFIX = "/dashboard/lessons";

const NOTE_MS = 2200;

function isExempt(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(EDITABLE));
}

export default function RightClickGuard({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const strict = Boolean(pathname?.startsWith(STRICT_PREFIX));
  const [note, setNote] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setNote(message);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  useEffect(() => {
    if (isAdmin) return;

    const onContextMenu = (event: MouseEvent) => {
      if (isExempt(event.target)) return;
      event.preventDefault();
      flash("The house keeps its cards face down.");
    };

    // Kills "drag the image onto the desktop", which sidesteps the menu.
    const onDragStart = (event: DragEvent) => {
      if (isExempt(event.target)) return;
      const el = event.target;
      if (el instanceof Element && el.closest("img, video, canvas, svg, picture")) {
        event.preventDefault();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!strict || isExempt(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      // Save-page, print-to-PDF and view-source are the three that actually
      // walk away with the lesson. The devtools chords are included because
      // the owner asked for them; they are theatre (F12 is one menu click
      // away) and are NOT counted on for anything.
      const blocked =
        (mod && !event.shiftKey && (key === "s" || key === "p" || key === "u")) ||
        (mod && event.shiftKey && (key === "i" || key === "j" || key === "c")) ||
        event.key === "F12";
      if (!blocked) return;
      event.preventDefault();
      flash("Not from here.");
    };

    // Selection is blocked only on the Lectures pages, and only outside text
    // fields — see the CSS rule that re-enables those.
    const onCopy = (event: ClipboardEvent) => {
      if (!strict || isExempt(event.target)) return;
      event.preventDefault();
      flash("Not from here.");
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCopy, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("dragstart", onDragStart, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCopy, true);
    };
  }, [isAdmin, strict, flash]);

  // `user-select: none` lives on <body> rather than a wrapper so it also covers
  // anything portalled out of the React tree (overlays, dialogs).
  useEffect(() => {
    if (isAdmin || !strict) return;
    document.body.classList.add("suite7-noselect");
    return () => document.body.classList.remove("suite7-noselect");
  }, [isAdmin, strict]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  if (!note) return null;
  return (
    <div className="suite7-guard-note" role="status" aria-live="polite">
      <span className="suite7-guard-suit" aria-hidden>♠</span>
      <span>{note}</span>
    </div>
  );
}
