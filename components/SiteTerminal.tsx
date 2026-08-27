"use client";

/**
 * SUITE 7 — CONSOLE. A hidden, draggable, minimisable command console that
 * floats over the dashboard.
 *
 * ─────────────────────────── SECURITY MODEL ───────────────────────────
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * 1. THE REAL GATE IS THE MOUNT, AND IT IS SERVER-SIDE.
 *    app/dashboard/layout.tsx is a server component. It resolves the session
 *    with requireMember() and computes `isAdmin` from the server session +
 *    ADMIN_DISCORD_ID, then renders this component ONLY for an administrator.
 *    For everybody else the element is never in the tree: no keystroke
 *    listener, no bubble, no passphrase response, nothing in the DOM. There is
 *    no client-side boolean a curious member can flip in devtools to summon
 *    it, because the markup and the listener simply do not exist for them.
 *
 * 2. THE PASSPHRASE IS NOT SECURITY. It ships in the JS bundle and anyone who
 *    reads the bundle can read it. Its ONLY job is to stop the console popping
 *    open by accident while the owner is typing — a second, deliberate step,
 *    nothing more. Never describe it as, or rely on it as, an auth boundary.
 *
 * 3. DEFENCE IN DEPTH — assume this component somehow got mounted for a member
 *    anyway. It must still be harmless, and it is:
 *      • Navigation commands only call the client router with URLs the app
 *        already serves. Each of those pages authorises the viewer itself
 *        (e.g. /dashboard/admin renders the Control Room only when the SERVER
 *        says isAdmin), so a member who lands there gets bounced. That is the
 *        correct behaviour, not a bug.
 *      • Data commands read existing member-scoped API routes
 *        (/api/table/chips, /api/table/leaderboard) that run their own session
 *        checks — the same reads the member's normal UI already performs.
 *      • /give POSTs the pre-existing /api/table/grant, which is guarded by
 *        requireAdminOrResponse, rate-limited, audited, and bounded. A
 *        non-admin calling it gets a 403 no matter what this client believes.
 *        The client-side bound in lib/terminal-commands.ts is a friendly
 *        message, NOT a limit.
 *      • No privileged action is gated on the passphrase, no command branches
 *        on a client-side `isAdmin` for anything that matters (it only tweaks
 *        wording), and NO new API route was added for the console.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Layering: z-index 120 — above the page chrome (top nav 40, first-visit tour
 * 80) but deliberately BELOW SiteMeditation (500) and the VPN/screen guards
 * (99999), which must always be able to cover the console.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  PALETTE,
  completeCommand,
  parseLineSpans,
  runCommand,
  type TerminalContext,
} from "@/lib/terminal-commands";

/** A second deliberate step, not a secret. See the security note above. */
const PASSPHRASE = "acen007";

const KEY_UNLOCKED = "suite7:terminalUnlocked";
const KEY_POS = "suite7:terminalPos";
const KEY_MIN = "suite7:terminalMin";

const MIN_W = 340;
const MIN_H = 220;
const DEFAULT_W = 560;
const DEFAULT_H = 380;
/** Below this width the panel becomes a bottom sheet instead of a window. */
const NARROW_BREAKPOINT = 700;
const MAX_SCROLLBACK = 400;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BANNER: string[] = [
  `[[${PALETTE.gold}|SUITE 7 — CONSOLE]]`,
  `[[rgba(245,240,240,0.55)|Type /help for the command list. Esc minimises.]]`,
  "",
];

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — the console just forgets between visits */
  }
}

function clampRect(rect: Rect): Rect {
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const w = Math.min(Math.max(rect.w, MIN_W), Math.max(MIN_W, vw - 16));
  const h = Math.min(Math.max(rect.h, MIN_H), Math.max(MIN_H, vh - 16));
  return {
    w,
    h,
    x: Math.min(Math.max(rect.x, 8), Math.max(8, vw - w - 8)),
    y: Math.min(Math.max(rect.y, 8), Math.max(8, vh - h - 8)),
  };
}

function defaultRect(): Rect {
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  return clampRect({
    w: DEFAULT_W,
    h: DEFAULT_H,
    x: vw - DEFAULT_W - 40,
    y: vh - DEFAULT_H - 60,
  });
}

function readRect(): Rect {
  const raw = readStore(KEY_POS);
  if (!raw) return defaultRect();
  try {
    const parsed = JSON.parse(raw) as Partial<Rect>;
    if (
      typeof parsed?.x === "number" &&
      typeof parsed?.y === "number" &&
      typeof parsed?.w === "number" &&
      typeof parsed?.h === "number"
    ) {
      return clampRect(parsed as Rect);
    }
  } catch {
    /* corrupt entry — fall through to the default */
  }
  return defaultRect();
}

/** True when the keystroke landed in something the member is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    element.isContentEditable === true
  );
}

interface SiteTerminalProps {
  /**
   * Cosmetic only — it tweaks wording in /whoami. Mounting is what actually
   * gates the console, and that decision is made on the server.
   */
  isAdmin?: boolean;
}

export default function SiteTerminal({ isAdmin = true }: SiteTerminalProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [rect, setRect] = useState<Rect>({
    x: 40,
    y: 40,
    w: DEFAULT_W,
    h: DEFAULT_H,
  });
  const [narrow, setNarrow] = useState(false);
  const [lines, setLines] = useState<string[]>(BANNER);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const bufferRef = useRef("");
  const unlockedRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const append = useCallback((next: string[]) => {
    if (next.length === 0) return;
    setLines((current) => [...current, ...next].slice(-MAX_SCROLLBACK));
  }, []);

  const openConsole = useCallback(() => {
    setOpen(true);
    setMinimized(false);
    writeStore(KEY_MIN, "0");
  }, []);

  const closeConsole = useCallback(() => {
    setOpen(false);
    setMinimized(false);
    writeStore(KEY_MIN, "0");
  }, []);

  /* -------------------------------------------------- restore + viewport */

  useEffect(() => {
    unlockedRef.current = readStore(KEY_UNLOCKED) === "1";
    setRect(readRect());
    setNarrow(window.innerWidth < NARROW_BREAKPOINT);
    const onResize = () => {
      setNarrow(window.innerWidth < NARROW_BREAKPOINT);
      setRect((current) => clampRect(current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ------------------------------------------------ summon: buffer + keys */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Shortcut, available once this browser has seen the passphrase.
      const shortcut =
        event.ctrlKey &&
        (event.key === "`" ||
          (event.shiftKey && (event.key === "K" || event.key === "k")));
      if (shortcut && unlockedRef.current) {
        event.preventDefault();
        setMinimized(false);
        writeStore(KEY_MIN, "0");
        setOpen((current) => !current);
        return;
      }

      // Rolling passphrase buffer. Never runs while the member is typing into
      // a field, so it can't fire mid-journal-entry.
      if (isTypingTarget(event.target)) {
        bufferRef.current = "";
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;
      bufferRef.current = (bufferRef.current + event.key.toLowerCase()).slice(
        -PASSPHRASE.length
      );
      if (bufferRef.current === PASSPHRASE) {
        bufferRef.current = "";
        unlockedRef.current = true;
        writeStore(KEY_UNLOCKED, "1");
        setRect(readRect());
        const wasMinimized = readStore(KEY_MIN) === "1";
        setMinimized(wasMinimized);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* --------------------------------------------------------------- focus */

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines, open, minimized]);

  /* ------------------------------------------------------- size persistence */

  useEffect(() => {
    const node = panelRef.current;
    if (!node || narrow || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      setRect((current) =>
        current.w === w && current.h === h ? current : { ...current, w, h }
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, minimized, narrow]);

  useEffect(() => {
    if (!open) return;
    // Debounced: a drag updates `rect` every frame, and localStorage is not a
    // place to write sixty times a second.
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      writeStore(KEY_POS, JSON.stringify(rect));
    }, 250);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [rect, open]);

  /* ---------------------------------------------------------------- drag */

  const onTitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (narrow) return;
      if ((event.target as HTMLElement).closest("button")) return;
      dragRef.current = { dx: event.clientX - rect.x, dy: event.clientY - rect.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [narrow, rect.x, rect.y]
  );

  const onTitlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      setRect((current) =>
        clampRect({
          ...current,
          x: event.clientX - drag.dx,
          y: event.clientY - drag.dy,
        })
      );
    },
    []
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /* ------------------------------------------------------------- context */

  const ctx: TerminalContext = useMemo(
    () => ({
      router: { push: (href: string) => router.push(href) },
      isAdmin,
      pathname: pathname ?? "/dashboard",
      clear: () => setLines([]),
      close: () => closeConsole(),
      openExternal: (href: string) => {
        window.open(href, "_blank", "noopener,noreferrer");
      },
    }),
    [router, isAdmin, pathname, closeConsole]
  );

  /* ------------------------------------------------------------- submit */

  const submit = useCallback(async () => {
    const typed = input;
    const trimmed = typed.trim();
    setInput("");
    setHistoryIndex(-1);
    if (trimmed === "") return;
    setHistory((current) => [...current.filter((h) => h !== trimmed), trimmed].slice(-50));
    append([`[[${PALETTE.gold}|>]] ${trimmed}`]);
    setBusy(true);
    try {
      const output = await runCommand(trimmed, ctx);
      append(output);
    } finally {
      setBusy(false);
    }
  }, [input, ctx, append]);

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMinimized(true);
        writeStore(KEY_MIN, "1");
        return;
      }
      if (event.key === "l" && event.ctrlKey) {
        event.preventDefault();
        setLines([]);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const [head, ...rest] = input.trim().split(/\s+/);
        if (rest.length > 0) return;
        const matches = completeCommand(head ?? "");
        if (matches.length === 1) {
          setInput(`/${matches[0]} `);
        } else if (matches.length > 1) {
          append([`[[rgba(245,240,240,0.55)|${matches.map((m) => `/${m}`).join("  ")}]]`]);
        }
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (history.length === 0) return;
        const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        setInput(history[next] ?? "");
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (history.length === 0 || historyIndex < 0) return;
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(-1);
          setInput("");
        } else {
          setHistoryIndex(next);
          setInput(history[next] ?? "");
        }
      }
    },
    [submit, input, history, historyIndex, append]
  );

  /* -------------------------------------------------------------- render */

  // Nothing exists until the console is summoned.
  if (!open) return null;

  if (minimized) {
    return (
      <button
        type="button"
        className="suite7-term-bubble"
        aria-label="Restore the Suite 7 console"
        onClick={() => {
          setMinimized(false);
          writeStore(KEY_MIN, "0");
        }}
      >
        <span aria-hidden>&gt;_</span>
      </button>
    );
  }

  const panelStyle: React.CSSProperties = narrow
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: "62vh",
        borderRadius: "14px 14px 0 0",
      }
    : {
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        borderRadius: 12,
        resize: "both",
        minWidth: MIN_W,
        minHeight: MIN_H,
      };

  return (
    <div
      ref={panelRef}
      className="suite7-term"
      role="dialog"
      aria-labelledby="suite7-term-title"
      aria-describedby="suite7-term-log"
      style={panelStyle}
    >
      <div
        className="suite7-term-bar"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: narrow ? "default" : "move" }}
      >
        <span id="suite7-term-title" className="suite7-term-title">
          Suite 7 — Console
        </span>
        <span className="suite7-term-actions">
          <button
            type="button"
            className="suite7-term-btn"
            aria-label="Minimise the console"
            onClick={() => {
              setMinimized(true);
              writeStore(KEY_MIN, "1");
            }}
          >
            <span aria-hidden>—</span>
          </button>
          <button
            type="button"
            className="suite7-term-btn suite7-term-btn-close"
            aria-label="Close the console"
            onClick={closeConsole}
          >
            <span aria-hidden>✕</span>
          </button>
        </span>
      </div>

      <div
        id="suite7-term-log"
        ref={scrollRef}
        className="suite7-term-log"
        role="log"
        aria-live="polite"
        aria-label="Console output"
      >
        {lines.map((line, index) => (
          <div key={index} className="suite7-term-line">
            {parseLineSpans(line).map((span, spanIndex) => (
              <span key={spanIndex} style={span.color ? { color: span.color } : undefined}>
                {span.text === "" ? " " : span.text}
              </span>
            ))}
          </div>
        ))}
      </div>

      <form
        className="suite7-term-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span aria-hidden className="suite7-term-prompt">
          &gt;
        </span>
        <input
          ref={inputRef}
          className="suite7-term-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="Console command"
          placeholder={busy ? "working…" : "/help"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </form>
    </div>
  );
}