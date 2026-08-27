import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_TABS,
  CANONICAL_NAMES,
  COMMANDS,
  COMMAND_NAMES,
  DEFAULT_GIVE,
  MAX_DIE_SIDES,
  MAX_GIVE,
  MIN_DIE_SIDES,
  adminTabHref,
  completeCommand,
  findCommand,
  formatHelp,
  levenshtein,
  parseCommandLine,
  parseDieSides,
  parseGiveAmount,
  parseLineSpans,
  runCommand,
  stripMarkup,
  suggestCommand,
  unknownCommandLines,
  type TerminalContext,
} from "@/lib/terminal-commands";

function makeCtx(overrides: Partial<TerminalContext> = {}): TerminalContext & {
  pushed: string[];
} {
  const pushed: string[] = [];
  const ctx = {
    pushed,
    router: { push: (href: string) => pushed.push(href) },
    isAdmin: true,
    pathname: "/dashboard",
    random: () => 0.5,
    ...overrides,
  };
  return ctx as TerminalContext & { pushed: string[] };
}

const plain = (lines: string[]) => lines.map(stripMarkup);
const joined = (lines: string[]) => plain(lines).join("\n");

describe("registry hygiene", () => {
  it("gives every command a non-empty description and a unique name", () => {
    const names = new Set<string>();
    for (const command of COMMANDS) {
      expect(command.description.trim().length).toBeGreaterThan(0);
      expect(command.name).toMatch(/^[a-z][a-z-]*$/);
      expect(names.has(command.name)).toBe(false);
      names.add(command.name);
    }
  });

  it("never registers the same alias twice", () => {
    const seen = new Set<string>();
    for (const command of COMMANDS) {
      for (const alias of command.aliases ?? []) {
        expect(seen.has(alias)).toBe(false);
        expect(names(COMMANDS).includes(alias)).toBe(false);
        seen.add(alias);
      }
    }
    function names(commands: typeof COMMANDS) {
      return commands.map((c) => c.name);
    }
  });

  it("exposes canonical names as a subset of every answerable name", () => {
    for (const name of CANONICAL_NAMES) expect(COMMAND_NAMES).toContain(name);
    expect(COMMAND_NAMES.length).toBeGreaterThan(CANONICAL_NAMES.length);
  });
});

describe("lookup and aliases", () => {
  it("finds a command by its canonical name", () => {
    expect(findCommand("help")?.name).toBe("help");
  });

  it("forgives a leading slash, whitespace and casing", () => {
    expect(findCommand("  /HELP ")?.name).toBe("help");
  });

  it("resolves aliases to the same command object", () => {
    expect(findCommand("lessons")).toBe(findCommand("lectures"));
    expect(findCommand("exit")).toBe(findCommand("close"));
    expect(findCommand("grant")).toBe(findCommand("give"));
  });

  it("returns undefined for something unregistered", () => {
    expect(findCommand("nope")).toBeUndefined();
  });
});

describe("argument parsing", () => {
  it("splits a name and arguments, slash optional", () => {
    expect(parseCommandLine("/roll 20")).toEqual({ name: "roll", args: ["20"] });
    expect(parseCommandLine("roll 20")).toEqual({ name: "roll", args: ["20"] });
  });

  it("collapses runs of whitespace and lowercases the name", () => {
    expect(parseCommandLine("   /HELP    roll  ")).toEqual({
      name: "help",
      args: ["roll"],
    });
  });

  it("keeps a quoted run together", () => {
    expect(parseCommandLine('/help "two words" tail')).toEqual({
      name: "help",
      args: ["two words", "tail"],
    });
  });

  it("returns null for a blank line or a bare slash", () => {
    expect(parseCommandLine("")).toBeNull();
    expect(parseCommandLine("   ")).toBeNull();
    expect(parseCommandLine("/")).toBeNull();
  });
});

describe("unknown commands and did-you-mean", () => {
  it("measures edit distance", () => {
    expect(levenshtein("help", "help")).toBe(0);
    expect(levenshtein("hepl", "help")).toBe(2);
    expect(levenshtein("", "roll")).toBe(4);
  });

  it("suggests the nearest command for a typo", () => {
    expect(suggestCommand("hepl")).toBe("help");
    expect(suggestCommand("jurnal")).toBe("journal");
    expect(suggestCommand("chps")).toBe("chips");
  });

  it("resolves a near-miss on an alias back to the canonical name", () => {
    expect(suggestCommand("lesson")).toBe("lectures");
  });

  it("suggests nothing when nothing is close", () => {
    expect(suggestCommand("zzzzzzzzzzqqqq")).toBeNull();
    expect(suggestCommand("")).toBeNull();
  });

  it("prints a helpful unknown-command message with the suggestion", () => {
    const text = joined(unknownCommandLines("hepl"));
    expect(text).toContain("Unknown command: /hepl");
    expect(text).toContain("/help");
    expect(text).toContain("Try /help.");
  });

  it("routes an unknown line through runCommand", async () => {
    const text = joined(await runCommand("/flipp", makeCtx()));
    expect(text).toContain("Unknown command: /flipp");
    expect(text).toContain("/flip");
  });
});

describe("/help output shape", () => {
  it("lists every command exactly once, grouped and aligned", () => {
    const lines = formatHelp();
    const text = joined(lines);
    expect(lines[0]).toContain("SUITE 7");
    for (const command of COMMANDS) {
      const entries = plain(lines).filter((line) =>
        new RegExp(`^\\s{2}/${command.name}\\s`).test(line)
      );
      expect(entries, command.name).toHaveLength(1);
      expect(text).toContain(command.description);
    }
    expect(text).toContain("NAVIGATION");
    expect(text).toContain("THE HOUSE");
    expect(text).toContain("UTILITY");
    expect(text).toContain("FLAVOUR");
  });

  it("pads the command column to a single width", () => {
    const entries = plain(formatHelp()).filter((line) => /^\s{2}\//.test(line));
    const columns = new Set(
      entries.map((line) => line.length - line.replace(/^\s*\/\S+\s+/, "").length)
    );
    expect(entries.length).toBe(COMMANDS.length);
    expect(columns.size).toBe(1);
  });

  it("details a single command, including usage and aliases", () => {
    const text = joined(formatHelp("roll"));
    expect(text).toContain("/roll");
    expect(text).toContain("usage");
    expect(text).toContain("/roll [sides]");
    expect(text).toContain("/dice");
  });

  it("falls back to the unknown-command message for a bad topic", () => {
    expect(joined(formatHelp("nonsense"))).toContain("Unknown command");
  });
});

describe("tab completion", () => {
  it("completes a prefix to canonical names", () => {
    expect(completeCommand("he")).toEqual(["help"]);
    expect(completeCommand("/he")).toEqual(["help"]);
    expect(completeCommand("j")).toEqual(["journal"]);
  });

  it("returns every canonical name for an empty prefix", () => {
    expect(completeCommand("")).toEqual([...CANONICAL_NAMES]);
  });

  it("falls back to aliases when no canonical name matches", () => {
    expect(completeCommand("cls")).toEqual(["clear"]);
  });
});

describe("navigation", () => {
  it("pushes the router rather than touching location", async () => {
    const ctx = makeCtx();
    await runCommand("/lobby", ctx);
    await runCommand("/lectures", ctx);
    await runCommand("/journal", ctx);
    await runCommand("/homework", ctx);
    await runCommand("/table", ctx);
    expect(ctx.pushed).toEqual([
      "/dashboard",
      "/dashboard/lessons",
      "/dashboard/journal",
      "/dashboard/homework",
      "/dashboard/table",
    ]);
  });

  it("maps admin tabs onto the URLs AdminPanel already deep-links", () => {
    expect(adminTabHref()).toBe("/dashboard/admin");
    expect(adminTabHref("homework")).toBe("/dashboard/admin");
    for (const tab of ADMIN_TABS.filter((t) => t !== "homework")) {
      expect(adminTabHref(tab)).toBe(`/dashboard/admin?tab=${tab}`);
    }
    expect(adminTabHref("nonsense")).toBeNull();
  });

  it("navigates to an admin tab and refuses an unknown one", async () => {
    const ctx = makeCtx();
    await runCommand("/admin security", ctx);
    expect(ctx.pushed).toEqual(["/dashboard/admin?tab=security"]);
    const text = joined(await runCommand("/admin sekurity", ctx));
    expect(text).toContain("Unknown admin tab");
    expect(ctx.pushed).toHaveLength(1);
  });

  it("routes the admin shortcuts", async () => {
    const ctx = makeCtx();
    await runCommand("/students", ctx);
    await runCommand("/videos", ctx);
    await runCommand("/announce", ctx);
    expect(ctx.pushed).toEqual([
      "/dashboard/admin?tab=students",
      "/dashboard/admin?tab=videos",
      "/dashboard/admin?tab=announcements",
    ]);
  });
});

describe("/roll bounds and bad input", () => {
  it("defaults to a six-sided die", () => {
    expect(parseDieSides()).toEqual({ ok: true, sides: 6 });
    expect(parseDieSides("")).toEqual({ ok: true, sides: 6 });
    expect(parseDieSides("  ")).toEqual({ ok: true, sides: 6 });
  });

  it("accepts sides inside the bounds", () => {
    expect(parseDieSides("20")).toEqual({ ok: true, sides: 20 });
    expect(parseDieSides(String(MIN_DIE_SIDES))).toEqual({
      ok: true,
      sides: MIN_DIE_SIDES,
    });
    expect(parseDieSides(String(MAX_DIE_SIDES))).toEqual({
      ok: true,
      sides: MAX_DIE_SIDES,
    });
  });

  it("rejects out-of-range, fractional and non-numeric input", () => {
    for (const bad of ["1", "0", "-4", "1001", "2.5", "six", "NaN", "Infinity"]) {
      const result = parseDieSides(bad);
      expect(result.ok, bad).toBe(false);
    }
  });

  it("never rolls outside 1..sides", async () => {
    for (const roll of [0, 0.5, 0.999999, 1]) {
      const ctx = makeCtx({ random: () => roll });
      const text = joined(await runCommand("/roll 6", ctx));
      const value = Number(/(\d+)$/.exec(text)?.[1]);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it("reports bad input instead of rolling", async () => {
    const text = joined(await runCommand("/roll banana", makeCtx()));
    expect(text).toContain("not a whole number");
  });
});

describe("/give", () => {
  it("defaults, and accepts negatives and thousands separators", () => {
    expect(parseGiveAmount()).toEqual({ ok: true, amount: DEFAULT_GIVE });
    expect(parseGiveAmount("5000")).toEqual({ ok: true, amount: 5000 });
    expect(parseGiveAmount("5,000")).toEqual({ ok: true, amount: 5000 });
    expect(parseGiveAmount("+250")).toEqual({ ok: true, amount: 250 });
    expect(parseGiveAmount("-250")).toEqual({ ok: true, amount: -250 });
    expect(parseGiveAmount(String(MAX_GIVE))).toEqual({ ok: true, amount: MAX_GIVE });
  });

  it("rejects zero, fractions, words and anything past the server bound", () => {
    for (const bad of ["0", "1.5", "lots", String(MAX_GIVE + 1), String(-MAX_GIVE - 1)]) {
      expect(parseGiveAmount(bad).ok, bad).toBe(false);
    }
  });

  it("prints the balance the SERVER returned", async () => {
    const grant = vi.fn().mockResolvedValue({
      balance: 6240,
      granted: 5000,
      stats: {
        handsPlayed: 0,
        handsWon: 0,
        handsPushed: 0,
        blackjacks: 0,
        biggestWin: 0,
        totalWagered: 0,
      },
    });
    const text = joined(await runCommand("/give 5000", makeCtx({ grant })));
    expect(grant).toHaveBeenCalledWith(5000);
    expect(text).toContain("+5,000");
    expect(text).toContain("6,240");
    expect(text).toContain("play chips only");
  });

  it("is reachable as /chips give", async () => {
    const grant = vi.fn().mockResolvedValue({
      balance: 100,
      granted: -50,
      stats: {
        handsPlayed: 0,
        handsWon: 0,
        handsPushed: 0,
        blackjacks: 0,
        biggestWin: 0,
        totalWagered: 0,
      },
    });
    const text = joined(await runCommand("/chips give -50", makeCtx({ grant })));
    expect(grant).toHaveBeenCalledWith(-50);
    expect(text).toContain("50");
  });

  it("surfaces the server's refusal rather than claiming success", async () => {
    const grant = vi.fn().mockRejectedValue(new Error("Admins only."));
    const text = joined(await runCommand("/give 10", makeCtx({ grant })));
    expect(text).toContain("Admins only.");
    expect(text).not.toContain("bankroll");
  });

  it("never calls the server for input it can reject locally", async () => {
    const grant = vi.fn();
    await runCommand("/give 0", makeCtx({ grant }));
    await runCommand("/give banana", makeCtx({ grant }));
    expect(grant).not.toHaveBeenCalled();
  });
});

describe("data commands read existing member-scoped routes", () => {
  const state = {
    balance: 1200,
    rank: 3,
    newGrants: [],
    stats: {
      handsPlayed: 10,
      handsWon: 4,
      handsPushed: 1,
      blackjacks: 2,
      biggestWin: 500,
      totalWagered: 2500,
    },
  };
  const board = {
    entries: [
      { rank: 1, displayName: "Ada", balance: 9000, handsWon: 40, isViewer: false },
      { rank: 2, displayName: "Bee", balance: 8000, handsWon: 30, isViewer: false },
    ],
    viewer: { rank: 7, displayName: "Cy", balance: 1200, handsWon: 4, isViewer: true },
  };

  it("/chips prints the bankroll and the stats", async () => {
    const text = joined(
      await runCommand("/chips", makeCtx({ chipState: async () => state }))
    );
    expect(text).toContain("1,200");
    expect(text).toContain("hands won      4");
    expect(text).toContain("board position #3");
  });

  it("/whoami prints the display name and standing, never an id", async () => {
    const text = joined(
      await runCommand("/whoami", makeCtx({ leaderboard: async () => board }))
    );
    expect(text).toContain("Cy");
    expect(text).toContain("#7");
    expect(text).not.toMatch(/\d{15,}/);
  });

  it("/rank prints the position and the top of the board", async () => {
    const text = joined(
      await runCommand("/rank", makeCtx({ leaderboard: async () => board }))
    );
    expect(text).toContain("#7");
    expect(text).toContain("Ada");
    expect(text).toContain("HIGH ROLLERS");
  });

  it("reports a failed read instead of throwing", async () => {
    const text = joined(
      await runCommand(
        "/chips",
        makeCtx({
          chipState: async () => {
            throw new Error("The table is unavailable right now.");
          },
        })
      )
    );
    expect(text).toContain("The table is unavailable right now.");
  });
});

describe("utility and flavour", () => {
  it("/clear and /close call back into the host and print nothing", async () => {
    const clear = vi.fn();
    const close = vi.fn();
    expect(await runCommand("/clear", makeCtx({ clear }))).toEqual([]);
    expect(await runCommand("/exit", makeCtx({ close }))).toEqual([]);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("/theme prints the gold swatches as coloured spans", async () => {
    const lines = await runCommand("/theme", makeCtx());
    const colors = lines.flatMap((line) =>
      parseLineSpans(line).map((span) => span.color)
    );
    expect(colors).toContain("#e3c071");
    expect(colors).toContain("#f7e8ac");
    expect(colors).toContain("#b8934a");
    expect(joined(lines)).toContain("#b21d3b");
  });

  it("/version prints a fixed build string", async () => {
    expect(joined(await runCommand("/version", makeCtx()))).toContain("SUITE 7 CONSOLE");
  });

  it("/flip lands on one of two faces", async () => {
    expect(joined(await runCommand("/flip", makeCtx({ random: () => 0.1 })))).toContain(
      "HEADS"
    );
    expect(joined(await runCommand("/flip", makeCtx({ random: () => 0.9 })))).toContain(
      "TAILS"
    );
  });

  it("/deal is display-only and says so", async () => {
    const text = joined(await runCommand("/deal", makeCtx()));
    expect(text).toContain("DEALER");
    expect(text).toContain("face down");
    expect(text.toLowerCase()).toContain("moves no chips");
  });

  it("/fortune returns a single line of house flavour", async () => {
    const lines = await runCommand("/fortune", makeCtx({ random: () => 0 }));
    expect(lines).toHaveLength(1);
    expect(stripMarkup(lines[0]).length).toBeGreaterThan(10);
  });

  it("runs a blank line as a no-op", async () => {
    expect(await runCommand("   ", makeCtx())).toEqual([]);
  });
});

describe("line markup", () => {
  it("splits coloured and plain spans", () => {
    expect(parseLineSpans("a [[#e3c071|B]] c")).toEqual([
      { text: "a " },
      { text: "B", color: "#e3c071" },
      { text: " c" },
    ]);
  });

  it("passes an unmarked line through untouched", () => {
    expect(parseLineSpans("plain")).toEqual([{ text: "plain" }]);
    expect(stripMarkup("plain")).toBe("plain");
  });
});
