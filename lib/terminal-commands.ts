/**
 * SUITE 7 — CONSOLE: the pure, testable half of the hidden floating terminal.
 *
 * Everything here is a plain function over plain data: parsing a typed line,
 * matching it to a command, suggesting a correction, formatting output. No
 * React, no DOM, no module-level I/O — so the whole surface is unit-testable
 * and the component (components/SiteTerminal.tsx) stays a thin renderer.
 *
 * SECURITY (the short version — the long one lives atop SiteTerminal.tsx):
 * the console is mounted server-side for administrators only, and no command
 * in this registry can do anything its caller is not independently authorised
 * to do. Every command either navigates the client router to a URL the app
 * already serves (and that page authorises the viewer itself), or reads an
 * existing member-scoped API route that runs its own session check. Nothing
 * here mutates state, and no route was added for it.
 */

import { RANKS, SUITS, type Card } from "@/lib/blackjack";
import { supportUrl } from "@/lib/support";
import {
  fetchChipState,
  fetchLeaderboard,
  postGrant,
  type ChipStateResponse,
  type GrantResponse,
  type LeaderboardResponse,
} from "@/lib/table-chips-client";

/* ------------------------------------------------------------------ palette */

/** The noir palette, shared with the component and printed by `/theme`. */
export const PALETTE = {
  gold: "#e3c071",
  goldHi: "#f7e8ac",
  goldDeep: "#b8934a",
  crimson: "#b21d3b",
  ink: "#171207",
  cream: "#F5F0F0",
} as const;

/**
 * Colour markup for a scrollback line: `[[#e3c071|TEXT]]`.
 *
 * Kept as text rather than React nodes so command output stays comparable in
 * tests; `parseLineSpans` turns it into spans at render time.
 */
export function paint(color: string, text: string): string {
  return `[[${color}|${text}]]`;
}

export const gold = (text: string) => paint(PALETTE.gold, text);
export const goldHi = (text: string) => paint(PALETTE.goldHi, text);
export const crimson = (text: string) => paint(PALETTE.crimson, text);
export const dim = (text: string) => paint("rgba(245,240,240,0.55)", text);

export interface LineSpan {
  text: string;
  color?: string;
}

const SPAN_RE = /\[\[([^|\]]+)\|([^\]]*)\]\]/g;

/** Split a scrollback line into coloured/plain spans. Never throws. */
export function parseLineSpans(line: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let cursor = 0;
  SPAN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPAN_RE.exec(line))) {
    if (match.index > cursor) {
      spans.push({ text: line.slice(cursor, match.index) });
    }
    spans.push({ text: match[2], color: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) spans.push({ text: line.slice(cursor) });
  return spans.length > 0 ? spans : [{ text: line }];
}

/** The same line with all colour markup removed — handy for tests and copy. */
export function stripMarkup(line: string): string {
  return parseLineSpans(line)
    .map((span) => span.text)
    .join("");
}

/* ------------------------------------------------------------------ context */

/** The slice of Next's router the registry is allowed to touch. */
export interface TerminalRouter {
  push(href: string): void;
}

/**
 * What a command may reach for. `router`, `isAdmin` and `pathname` are the
 * contract; the rest are injectable seams so tests never touch fetch, Math.random
 * or the DOM.
 *
 * `isAdmin` is COSMETIC ONLY — it may tweak wording, never authorise anything.
 */
export interface TerminalContext {
  router: TerminalRouter;
  isAdmin: boolean;
  pathname: string;
  /** Clear the scrollback (owned by the component). */
  clear?: () => void;
  /** Close the console (owned by the component). */
  close?: () => void;
  /** Open an off-site URL — only used when support lives on Discord. */
  openExternal?: (href: string) => void;
  random?: () => number;
  chipState?: () => Promise<ChipStateResponse>;
  leaderboard?: () => Promise<LeaderboardResponse>;
  grant?: (amount: number) => Promise<GrantResponse>;
}

const rng = (ctx: TerminalContext) => ctx.random ?? Math.random;
const readChips = (ctx: TerminalContext) => (ctx.chipState ?? fetchChipState)();
const readBoard = (ctx: TerminalContext) => (ctx.leaderboard ?? fetchLeaderboard)();
const sendGrant = (ctx: TerminalContext, amount: number) =>
  (ctx.grant ?? postGrant)(amount);

/* ----------------------------------------------------------------- commands */

export type CommandGroup = "navigation" | "house" | "utility" | "flavour";

export const GROUP_ORDER: readonly CommandGroup[] = [
  "navigation",
  "house",
  "utility",
  "flavour",
];

export const GROUP_LABELS: Record<CommandGroup, string> = {
  navigation: "Navigation",
  house: "The House",
  utility: "Utility",
  flavour: "Flavour",
};

export type CommandOutput = string | string[];

export interface TerminalCommand {
  /** Canonical name, without the leading slash. */
  name: string;
  aliases?: readonly string[];
  group: CommandGroup;
  description: string;
  usage?: string;
  run(
    args: readonly string[],
    ctx: TerminalContext
  ): CommandOutput | Promise<CommandOutput>;
}

/** Navigate and echo where we went. */
function go(ctx: TerminalContext, href: string, label: string): string[] {
  ctx.router.push(href);
  return [`${gold("→")} ${label.toUpperCase()}  ${dim(href)}`];
}

/* ---------------------------------------------------------- admin nav table */

/** The tabs components/AdminPanel.tsx already renders, in its own order. */
export const ADMIN_TABS = [
  "homework",
  "students",
  "videos",
  "announcements",
  "security",
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

/** AdminPanel's default tab — it drops the query param for this one. */
export const ADMIN_DEFAULT_TAB: AdminTab = "homework";

export function isAdminTab(value: string): value is AdminTab {
  return (ADMIN_TABS as readonly string[]).includes(value);
}

/**
 * The URL for an admin tab, matching how AdminPanel deep-links today.
 * Returns null for anything that isn't a real tab.
 */
export function adminTabHref(tab?: string): string | null {
  if (tab === undefined) return "/dashboard/admin";
  const normalized = tab.trim().toLowerCase();
  if (!isAdminTab(normalized)) return null;
  return normalized === ADMIN_DEFAULT_TAB
    ? "/dashboard/admin"
    : `/dashboard/admin?tab=${normalized}`;
}

/* ------------------------------------------------------------------ flavour */

const FORTUNES: readonly string[] = [
  "The house does not gamble. It waits.",
  "Every seat at this table was earned, not bought.",
  "Discipline is the only chip that never leaves the felt.",
  "The dealer remembers the hands you folded well.",
  "Luck is what the prepared call Tuesday.",
  "Nobody wins the room in one night. They win it in a hundred.",
  "Count the work, not the winnings.",
  "The quiet player takes the pot.",
];

function drawCard(random: () => number): Card {
  const rank = RANKS[Math.floor(random() * RANKS.length) % RANKS.length];
  const suit = SUITS[Math.floor(random() * SUITS.length) % SUITS.length];
  return { rank, suit };
}

export function formatCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/** `/roll` argument validation, split out so the bounds are testable. */
export function parseDieSides(
  raw?: string
): { ok: true; sides: number } | { ok: false; error: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, sides: 6 };
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, error: `"${raw}" is not a whole number. Usage: /roll [sides]` };
  }
  if (value < MIN_DIE_SIDES || value > MAX_DIE_SIDES) {
    return {
      ok: false,
      error: `A die needs between ${MIN_DIE_SIDES} and ${MAX_DIE_SIDES} sides.`,
    };
  }
  return { ok: true, sides: value };
}

export const MIN_DIE_SIDES = 2;
export const MAX_DIE_SIDES = 1000;

/**
 * `/give` bound, mirroring the server's MAX_GRANT. Duplicated deliberately:
 * lib/table-chips-store.ts is server-only, and this copy is a FRIENDLINESS
 * check, not a limit — /api/table/grant re-validates and is the authority.
 */
export const MAX_GIVE = 1_000_000;
/** What a bare `/give` grants. */
export const DEFAULT_GIVE = 1000;

/** `/give` argument validation. Pure, so the bounds are testable. */
export function parseGiveAmount(
  raw?: string
): { ok: true; amount: number } | { ok: false; error: string } {
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, amount: DEFAULT_GIVE };
  }
  const cleaned = raw.trim().replace(/[,_]/g, "").replace(/^\+/, "");
  const value = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return {
      ok: false,
      error: `"${raw}" is not a whole number of chips. Usage: /give [amount]`,
    };
  }
  if (value === 0) return { ok: false, error: "Zero chips is not a grant." };
  if (Math.abs(value) > MAX_GIVE) {
    return {
      ok: false,
      error: `The House moves at most ${MAX_GIVE.toLocaleString("en-US")} chips at a time.`,
    };
  }
  return { ok: true, amount: value };
}

/** Shared by `/give` and `/chips give`. */
async function runGive(
  args: readonly string[],
  ctx: TerminalContext
): Promise<string[]> {
  const parsed = parseGiveAmount(args[0]);
  if (!parsed.ok) return [crimson(`! ${parsed.error}`)];
  try {
    // The SERVER decides. A 403 here is the correct outcome for anyone who
    // isn't an administrator, and its error copy is what we print.
    const result = await sendGrant(ctx, parsed.amount);
    const sign = result.granted >= 0 ? "+" : "−";
    return [
      `${goldHi(`${sign}${Math.abs(result.granted).toLocaleString("en-US")}`)} ${dim(
        "—"
      )} bankroll ${gold(result.balance.toLocaleString("en-US"))}`,
      dim("play chips only — no purchase, no cash-out. Server-authorised, audited."),
    ];
  } catch (error) {
    return [
      crimson(`! ${errorText(error)}`),
      dim("the grant endpoint authorises every call itself"),
    ];
  }
}

/**
 * Reads the seat history for the signed-in account and prints it.
 *
 * Built for one question, after four rounds of "it let me in anyway": WHICH
 * of the ways a refusal can be followed by an admission actually happened.
 * `revokeReason` on the seat that stopped being current is the answer, and the
 * idle window it prints doubles as a build marker — if it says 3 minutes, the
 * running deploy predates the fix and nothing else in the output means much.
 */
async function runSeats(
  _args: readonly string[],
  _ctx: TerminalContext
): Promise<string[]> {
  try {
    const res = await fetch("/api/admin/sessions/history", { cache: "no-store" });
    if (res.status === 404) {
      return [
        crimson("! endpoint not found — this deploy predates the seat diagnostic"),
        dim("nothing shipped after the one-session work is live yet"),
      ];
    }
    if (!res.ok) return [crimson(`! ${res.status} — the endpoint authorises every call itself`)];
    const data = (await res.json()) as {
      idleWindowMs?: number;
      sessions?: {
        sessionId: string;
        createdAt: string;
        lastSeenAt: string;
        staleForMs: number | null;
        countsAsLive: boolean;
        revokeReason: string | null;
        fingerprint: string | null;
      }[];
    };

    const idleMinutes = Math.round((data.idleWindowMs ?? 0) / 60_000);
    const lines = [
      `${dim("idle window")} ${gold(`${idleMinutes} min`)} ${dim(
        idleMinutes >= 10 ? "(current build)" : "(OLD BUILD — fixes are not live)"
      )}`,
    ];

    const sessions = data.sessions ?? [];
    if (sessions.length === 0) return [...lines, dim("no seats on record for this account")];

    for (const seat of sessions.slice(0, 8)) {
      const stale = seat.staleForMs === null ? "?" : `${Math.round(seat.staleForMs / 1000)}s`;
      const state = seat.countsAsLive
        ? goldHi("LIVE")
        : crimson(seat.revokeReason ?? "expired");
      lines.push(
        `${state} ${dim(seat.sessionId.slice(0, 8))} ${dim("last beat")} ${stale} ${dim(
          "ago"
        )} ${dim(seat.fingerprint ?? "no device")}`
      );
    }
    lines.push(
      dim("signed_out = a browser called sign-out · superseded = the seat went quiet first")
    );
    return lines;
  } catch (error) {
    return [crimson(`! ${errorText(error)}`)];
  }
}

/* ----------------------------------------------------------------- registry */

/** Build info. Static on purpose — nothing here should leak the deploy. */
export const CONSOLE_VERSION = "SUITE 7 CONSOLE v1.0";

function chipLines(state: ChipStateResponse): string[] {
  const { balance, stats } = state;
  const winRate =
    stats.handsPlayed > 0
      ? `${Math.round((stats.handsWon / stats.handsPlayed) * 100)}%`
      : "—";
  return [
    `${gold("BANKROLL")}  ${goldHi(balance.toLocaleString("en-US"))} play chips`,
    dim("play chips only — cosmetic bragging rights, never money"),
    "",
    `  hands played   ${stats.handsPlayed}`,
    `  hands won      ${stats.handsWon}  (${winRate})`,
    `  pushed         ${stats.handsPushed}`,
    `  blackjacks     ${stats.blackjacks}`,
    `  biggest win    ${stats.biggestWin.toLocaleString("en-US")}`,
    `  total wagered  ${stats.totalWagered.toLocaleString("en-US")}`,
    `  board position #${state.rank}`,
  ];
}

function viewerRow(board: LeaderboardResponse) {
  return board.viewer ?? board.entries.find((entry) => entry.isViewer) ?? null;
}

export const COMMANDS: readonly TerminalCommand[] = [
  /* ---------------------------------------------------------- navigation */
  {
    name: "lobby",
    aliases: ["home", "dashboard"],
    group: "navigation",
    description: "The Lobby — the dashboard overview.",
    run: (_args, ctx) => go(ctx, "/dashboard", "The Lobby"),
  },
  {
    name: "lectures",
    aliases: ["lessons"],
    group: "navigation",
    description: "The lecture floor.",
    run: (_args, ctx) => go(ctx, "/dashboard/lessons", "Lectures"),
  },
  {
    name: "journal",
    group: "navigation",
    description: "Your journal.",
    run: (_args, ctx) => go(ctx, "/dashboard/journal", "Journal"),
  },
  {
    name: "homework",
    aliases: ["hw"],
    group: "navigation",
    description: "Homework and the archive.",
    run: (_args, ctx) => go(ctx, "/dashboard/homework", "Homework"),
  },
  {
    name: "table",
    aliases: ["blackjack"],
    group: "navigation",
    description: "The Table.",
    run: (_args, ctx) => go(ctx, "/dashboard/table", "The Table"),
  },
  {
    name: "support",
    aliases: ["help-desk"],
    group: "navigation",
    description: "Open support.",
    run: (_args, ctx) => {
      const href = supportUrl();
      if (href.startsWith("/")) return go(ctx, href, "Support");
      ctx.openExternal?.(href);
      return [`${gold("→")} SUPPORT  ${dim(href)}`];
    },
  },

  /* --------------------------------------------------------- the house */
  {
    name: "admin",
    aliases: ["house", "control"],
    group: "house",
    description: "The Control Room (optionally straight to a tab).",
    usage: `/admin [${ADMIN_TABS.join("|")}]`,
    run: (args, ctx) => {
      const href = adminTabHref(args[0]);
      if (!href) {
        return [
          crimson(`Unknown admin tab "${args[0]}".`),
          dim(`Tabs: ${ADMIN_TABS.join(", ")}`),
        ];
      }
      const label = args[0] ? `Control Room · ${args[0].toLowerCase()}` : "Control Room";
      return [
        ...go(ctx, href, label),
        dim("the page authorises you itself — the server decides, not this console"),
      ];
    },
  },
  {
    name: "queue",
    group: "house",
    description: "Control Room → Homework review queue.",
    run: (_args, ctx) => go(ctx, adminTabHref("homework")!, "Control Room · homework"),
  },
  {
    name: "students",
    group: "house",
    description: "Control Room → Students.",
    run: (_args, ctx) => go(ctx, adminTabHref("students")!, "Control Room · students"),
  },
  {
    name: "videos",
    group: "house",
    description: "Control Room → Videos.",
    run: (_args, ctx) => go(ctx, adminTabHref("videos")!, "Control Room · videos"),
  },
  {
    name: "announcements",
    aliases: ["announce"],
    group: "house",
    description: "Control Room → Announcements.",
    run: (_args, ctx) =>
      go(ctx, adminTabHref("announcements")!, "Control Room · announcements"),
  },
  {
    name: "security",
    group: "house",
    description: "Control Room → Security.",
    run: (_args, ctx) => go(ctx, adminTabHref("security")!, "Control Room · security"),
  },
  {
    name: "seats",
    aliases: ["sessions"],
    group: "house",
    description:
      "Every seat this account has held, live and revoked, with the reason each one ended. Also prints the idle window, which tells you whether the running deploy is current.",
    usage: "/seats",
    run: (args, ctx) => runSeats(args, ctx),
  },
  {
    name: "give",
    aliases: ["grant"],
    group: "house",
    description:
      "Top up your own play-chip rack (negative takes chips away). Play chips only — no purchase, no cash-out; the grant is authorised and audited server-side.",
    usage: "/give [amount]   (default 1000, negative subtracts)",
    run: (args, ctx) => runGive(args, ctx),
  },

  /* ----------------------------------------------------------- utility */
  {
    name: "help",
    aliases: ["?", "commands"],
    group: "utility",
    description: "List the commands. /help <command> for detail.",
    usage: "/help [command]",
    run: (args) => formatHelp(args[0]),
  },
  {
    name: "whoami",
    aliases: ["me"],
    group: "utility",
    description: "Your display name and standing.",
    run: async (_args, ctx) => {
      try {
        const board = await readBoard(ctx);
        const row = viewerRow(board);
        if (!row) return [dim("The board doesn't have a row for you yet.")];
        return [
          `${gold("NAME")}   ${goldHi(row.displayName)}`,
          `${gold("SEAT")}   #${row.rank} on the chip board`,
          `${gold("CHIPS")}  ${row.balance.toLocaleString("en-US")}`,
          `${gold("HERE")}   ${ctx.pathname}`,
          dim(
            ctx.isAdmin
              ? "house console — every request is still authorised server-side"
              : "member session"
          ),
        ];
      } catch (error) {
        return [crimson(`! ${errorText(error)}`)];
      }
    },
  },
  {
    name: "chips",
    aliases: ["bank", "bankroll"],
    group: "utility",
    description: "Bankroll and hand statistics. /chips give <amount> tops up.",
    usage: "/chips [give <amount>]",
    run: async (args, ctx) => {
      if (args[0]?.toLowerCase() === "give" || args[0]?.toLowerCase() === "grant") {
        return runGive(args.slice(1), ctx);
      }
      try {
        return chipLines(await readChips(ctx));
      } catch (error) {
        return [crimson(`! ${errorText(error)}`)];
      }
    },
  },
  {
    name: "rank",
    aliases: ["board", "leaderboard"],
    group: "utility",
    description: "Your position on the chip leaderboard.",
    run: async (_args, ctx) => {
      try {
        const board = await readBoard(ctx);
        const row = viewerRow(board);
        const top = board.entries.slice(0, 3).map((entry, index) => {
          const marker = entry.isViewer ? gold(" ←") : "";
          return `  ${index + 1}. ${entry.displayName}  ${dim(
            entry.balance.toLocaleString("en-US")
          )}${marker}`;
        });
        return [
          row
            ? `${gold("YOUR SEAT")}  #${row.rank}  ${dim(
                `${row.balance.toLocaleString("en-US")} chips · ${row.handsWon} hands won`
              )}`
            : dim("No standing on the board yet."),
          "",
          gold("HIGH ROLLERS"),
          ...(top.length > 0 ? top : [dim("  the board is empty")]),
        ];
      } catch (error) {
        return [crimson(`! ${errorText(error)}`)];
      }
    },
  },
  {
    name: "clear",
    aliases: ["cls"],
    group: "utility",
    description: "Clear the scrollback.",
    run: (_args, ctx) => {
      ctx.clear?.();
      return [];
    },
  },
  {
    name: "close",
    aliases: ["exit", "quit"],
    group: "utility",
    description: "Close the console.",
    run: (_args, ctx) => {
      ctx.close?.();
      return [];
    },
  },
  {
    name: "theme",
    aliases: ["palette"],
    group: "utility",
    description: "Print the house palette.",
    run: () => [
      gold("HOUSE PALETTE"),
      `  ${paint(PALETTE.goldHi, "████")}  gold hi     ${PALETTE.goldHi}`,
      `  ${paint(PALETTE.gold, "████")}  gold        ${PALETTE.gold}`,
      `  ${paint(PALETTE.goldDeep, "████")}  gold deep   ${PALETTE.goldDeep}`,
      `  ${paint(PALETTE.crimson, "████")}  crimson     ${PALETTE.crimson}`,
      `  ${paint(PALETTE.cream, "████")}  cream       ${PALETTE.cream}`,
      `  ${paint("#3a2f18", "████")}  ink         ${PALETTE.ink}`,
    ],
  },
  {
    name: "version",
    aliases: ["about"],
    group: "utility",
    description: "Console build information.",
    run: () => [goldHi(CONSOLE_VERSION), dim("Suite 7 — high-roller noir.")],
  },

  /* ----------------------------------------------------------- flavour */
  {
    name: "flip",
    aliases: ["coin"],
    group: "flavour",
    description: "Flip a coin.",
    run: (_args, ctx) => {
      const heads = rng(ctx)() < 0.5;
      return [
        gold("   ,-.   "),
        gold(`  ( ${heads ? "H" : "T"} )  `),
        gold("   `-'   "),
        `${goldHi(heads ? "HEADS" : "TAILS")}`,
      ];
    },
  },
  {
    name: "roll",
    aliases: ["die", "dice"],
    group: "flavour",
    description: "Roll a die (default 6 sides).",
    usage: "/roll [sides]",
    run: (args, ctx) => {
      const parsed = parseDieSides(args[0]);
      if (!parsed.ok) return [crimson(`! ${parsed.error}`)];
      const value = Math.floor(rng(ctx)() * parsed.sides) + 1;
      const clamped = Math.min(Math.max(value, 1), parsed.sides);
      return [`${gold(`d${parsed.sides}`)}  ${goldHi(String(clamped))}`];
    },
  },
  {
    name: "deal",
    group: "flavour",
    description: "Deal a joke hand (display only).",
    run: (_args, ctx) => {
      const random = rng(ctx);
      const player = [drawCard(random), drawCard(random)];
      const dealer = [drawCard(random), drawCard(random)];
      return [
        `${gold("YOU")}     ${player.map(formatCard).join("  ")}`,
        `${gold("DEALER")}  ${formatCard(dealer[0])}  ${dim("[ face down ]")}`,
        "",
        dim("For show only. This deals nothing at The Table and moves no chips."),
      ];
    },
  },
  {
    name: "fortune",
    aliases: ["oracle"],
    group: "flavour",
    description: "A line from the house.",
    run: (_args, ctx) => {
      const index = Math.floor(rng(ctx)() * FORTUNES.length) % FORTUNES.length;
      return [goldHi(`“${FORTUNES[index]}”`)];
    },
  },
];

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong.";
}

/* ------------------------------------------------------------ lookup + parse */

const BY_NAME = new Map<string, TerminalCommand>();
for (const command of COMMANDS) {
  BY_NAME.set(command.name, command);
  for (const alias of command.aliases ?? []) BY_NAME.set(alias, command);
}

/** Every name and alias the console answers to, sorted. */
export const COMMAND_NAMES: readonly string[] = [...BY_NAME.keys()].sort();

/** Canonical names only — what `/help` lists and Tab completes to first. */
export const CANONICAL_NAMES: readonly string[] = COMMANDS.map((c) => c.name).sort();

/** Look a command up by name or alias. Leading slashes and case are forgiven. */
export function findCommand(name: string): TerminalCommand | undefined {
  return BY_NAME.get(name.trim().replace(/^\/+/, "").toLowerCase());
}

export interface ParsedLine {
  name: string;
  args: string[];
}

/**
 * Split a typed line into a command name and arguments. Quoted runs stay
 * together; the leading slash is optional. Returns null for a blank line.
 */
export function parseCommandLine(input: string): ParsedLine | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of trimmed) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) tokens.push(current);
  if (tokens.length === 0) return null;
  const name = tokens[0].replace(/^\/+/, "").toLowerCase();
  if (name === "") return null;
  return { name, args: tokens.slice(1) };
}

/* -------------------------------------------------------------- suggestions */

/** Classic iterative Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** The nearest command name, or null when nothing is close enough. */
export function suggestCommand(name: string): string | null {
  const needle = name.trim().replace(/^\/+/, "").toLowerCase();
  if (needle === "") return null;
  const limit = Math.max(2, Math.floor(needle.length / 2));
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of COMMAND_NAMES) {
    const distance = levenshtein(needle, candidate);
    // Ties go to the candidate that starts with the same letter — "hepl" is a
    // fumbled "help", not a "deal".
    const score = distance + (candidate[0] === needle[0] ? 0 : 0.5);
    if (score < bestScore) {
      bestScore = score;
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best === null || bestDistance > limit) return null;
  const canonical = findCommand(best);
  return canonical ? canonical.name : best;
}

/** The scrollback response to something that isn't a command. */
export function unknownCommandLines(name: string): string[] {
  const suggestion = suggestCommand(name);
  const lines = [crimson(`Unknown command: /${name}`)];
  if (suggestion) lines.push(`Did you mean ${gold(`/${suggestion}`)}?`);
  lines.push(dim("Try /help."));
  return lines;
}

/** Canonical names that start with `prefix` — the Tab-completion source. */
export function completeCommand(prefix: string): string[] {
  const needle = prefix.trim().replace(/^\/+/, "").toLowerCase();
  if (needle === "") return [...CANONICAL_NAMES];
  const direct = CANONICAL_NAMES.filter((name) => name.startsWith(needle));
  if (direct.length > 0) return direct;
  return [...new Set(
    COMMAND_NAMES.filter((name) => name.startsWith(needle)).map(
      (name) => findCommand(name)?.name ?? name
    )
  )].sort();
}

/* --------------------------------------------------------------------- help */

/** `/help`, or `/help <command>` for one command's detail. */
export function formatHelp(topic?: string): string[] {
  if (topic && topic.trim() !== "") {
    const command = findCommand(topic);
    if (!command) return unknownCommandLines(topic.replace(/^\/+/, ""));
    const lines = [
      `${gold(`/${command.name}`)}  ${dim(GROUP_LABELS[command.group])}`,
      `  ${command.description}`,
    ];
    if (command.usage) lines.push(`  ${dim("usage")}  ${command.usage}`);
    if (command.aliases?.length) {
      lines.push(`  ${dim("alias")}  ${command.aliases.map((a) => `/${a}`).join("  ")}`);
    }
    return lines;
  }

  const width = COMMANDS.reduce((max, c) => Math.max(max, c.name.length), 0) + 1;
  const lines: string[] = [gold("SUITE 7 — CONSOLE")];
  for (const group of GROUP_ORDER) {
    const members = COMMANDS.filter((command) => command.group === group);
    if (members.length === 0) continue;
    lines.push("", dim(GROUP_LABELS[group].toUpperCase()));
    for (const command of members) {
      lines.push(
        `  ${gold(`/${command.name}`.padEnd(width + 1))}  ${command.description}`
      );
    }
  }
  lines.push(
    "",
    dim("↑/↓ history · Tab completes · Esc minimises · Ctrl+L clears")
  );
  return lines;
}

/* ---------------------------------------------------------------- execution */

function toLines(output: CommandOutput): string[] {
  return Array.isArray(output) ? output : [output];
}

/**
 * Run a typed line and return the scrollback it produced. Never throws: a
 * command that blows up prints its message in crimson instead.
 */
export async function runCommand(
  input: string,
  ctx: TerminalContext
): Promise<string[]> {
  const parsed = parseCommandLine(input);
  if (!parsed) return [];
  const command = findCommand(parsed.name);
  if (!command) return unknownCommandLines(parsed.name);
  try {
    return toLines(await command.run(parsed.args, ctx));
  } catch (error) {
    return [crimson(`! ${errorText(error)}`)];
  }
}
