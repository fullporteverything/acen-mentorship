import { describe, expect, it } from "vitest";

import {
  DAILY_STIPEND_CHIPS,
  JOURNAL_DAY_CHIPS,
  LESSON_CHIPS,
  computeGrants,
  toDayKey,
  todayKey,
} from "./table-earn";

/** Stand-in for table_grants' UNIQUE (member_id, grant_key): drops known keys. */
function claim(ledger: Set<string>, grants: { grantKey: string; amount: number }[]) {
  const fresh = grants.filter((grant) => !ledger.has(grant.grantKey));
  for (const grant of fresh) ledger.add(grant.grantKey);
  return { granted: fresh, total: fresh.reduce((sum, g) => sum + g.amount, 0) };
}

describe("computeGrants", () => {
  it("pays lectures, journal days and the daily stipend on a first claim", () => {
    const grants = computeGrants({
      completedLessonIds: ["lesson-1", "lesson-2"],
      journalEntryDates: ["2026-08-20T09:12:00.000Z", "2026-08-21T22:00:00.000Z"],
      today: "2026-08-23",
    });

    expect(grants.map((g) => g.grantKey)).toEqual([
      "lesson:lesson-1",
      "lesson:lesson-2",
      "journal:2026-08-20",
      "journal:2026-08-21",
      "daily:2026-08-23",
    ]);
    expect(grants.reduce((sum, g) => sum + g.amount, 0)).toBe(
      LESSON_CHIPS * 2 + JOURNAL_DAY_CHIPS * 2 + DAILY_STIPEND_CHIPS
    );
    expect(grants.every((g) => g.label.length > 0)).toBe(true);
  });

  it("collapses several entries on one day into a single journal grant", () => {
    const grants = computeGrants({
      completedLessonIds: [],
      journalEntryDates: [
        "2026-08-20T01:00:00.000Z",
        "2026-08-20T13:30:00.000Z",
        "2026-08-20T23:59:00.000Z",
      ],
      today: "2026-08-20",
    });

    expect(grants.filter((g) => g.grantKey.startsWith("journal:"))).toHaveLength(1);
  });

  it("only counts days that actually have an entry", () => {
    const grants = computeGrants({
      completedLessonIds: [],
      journalEntryDates: [],
      today: "2026-08-23",
    });

    expect(grants.map((g) => g.grantKey)).toEqual(["daily:2026-08-23"]);
  });

  it("ignores blank lesson ids and unparseable entry dates", () => {
    const grants = computeGrants({
      completedLessonIds: ["", "   ", "lesson-1"],
      journalEntryDates: ["not-a-date", ""],
      today: "2026-08-23",
    });

    expect(grants.map((g) => g.grantKey)).toEqual(["lesson:lesson-1", "daily:2026-08-23"]);
  });

  it("is idempotent — claiming the same keys twice grants nothing new", () => {
    const input = {
      completedLessonIds: ["lesson-1"],
      journalEntryDates: ["2026-08-20T09:00:00.000Z"],
      today: "2026-08-23",
    };
    const ledger = new Set<string>();

    const first = claim(ledger, computeGrants(input));
    expect(first.total).toBe(LESSON_CHIPS + JOURNAL_DAY_CHIPS + DAILY_STIPEND_CHIPS);

    const second = claim(ledger, computeGrants(input));
    expect(second.granted).toEqual([]);
    expect(second.total).toBe(0);
  });

  it("pays a new lecture without re-paying the old ones", () => {
    const ledger = new Set<string>();
    claim(
      ledger,
      computeGrants({ completedLessonIds: ["lesson-1"], journalEntryDates: [], today: "2026-08-23" })
    );

    const next = claim(
      ledger,
      computeGrants({
        completedLessonIds: ["lesson-1", "lesson-2"],
        journalEntryDates: [],
        today: "2026-08-23",
      })
    );

    expect(next.granted.map((g) => g.grantKey)).toEqual(["lesson:lesson-2"]);
    expect(next.total).toBe(LESSON_CHIPS);
  });

  it("rolls the daily stipend over at the next calendar day", () => {
    const ledger = new Set<string>();
    const base = { completedLessonIds: [], journalEntryDates: [] };

    claim(ledger, computeGrants({ ...base, today: "2026-08-23" }));
    const sameDay = claim(ledger, computeGrants({ ...base, today: "2026-08-23" }));
    expect(sameDay.total).toBe(0);

    const nextDay = claim(ledger, computeGrants({ ...base, today: "2026-08-24" }));
    expect(nextDay.granted.map((g) => g.grantKey)).toEqual(["daily:2026-08-24"]);
    expect(nextDay.total).toBe(DAILY_STIPEND_CHIPS);
  });
});

describe("day keys", () => {
  it("normalizes timestamps and passes through plain dates", () => {
    expect(toDayKey("2026-08-23T17:45:00.000Z")).toBe("2026-08-23");
    expect(toDayKey("2026-08-23")).toBe("2026-08-23");
    expect(toDayKey("  ")).toBeNull();
    expect(toDayKey("nope")).toBeNull();
  });

  it("todayKey reads the injected clock in UTC", () => {
    expect(todayKey(new Date("2026-08-23T23:59:59.000Z"))).toBe("2026-08-23");
    expect(todayKey(new Date("2026-08-24T00:00:01.000Z"))).toBe("2026-08-24");
  });
});
