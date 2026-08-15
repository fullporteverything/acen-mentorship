import { describe, expect, it } from "vitest";
import {
  computeCurriculumStates,
  getLessonNavigation,
  isCoreLesson,
  isLessonUnlocked,
  partitionCurriculum,
  sectionLessonNumber,
  type Lesson,
} from "./lessons-config";

function lesson(id: string, group: string): Lesson {
  return {
    id,
    group,
    title: id,
    description: `${id} description`,
    homeworkPrompt: `${id} homework`,
    videoId: "",
  };
}

const interleaved = [
  lesson("core-1", "CORE CONTENT"),
  lesson("core-2", " core content "),
  lesson("weekly-1", "PA BREAKDOWNS"),
  lesson("core-3", "Core Content"),
  lesson("core-4", "CORE CONTENT"),
  lesson("weekly-2", "PA BREAKDOWNS"),
  lesson("bonus-1", "BONUS"),
];

describe("curriculum gating", () => {
  it("normalizes the CORE CONTENT group name", () => {
    expect(isCoreLesson(lesson("a", " core   content "))).toBe(true);
    expect(isCoreLesson(lesson("b", "PA BREAKDOWNS"))).toBe(false);
  });

  it("partitions curriculum without changing order inside either path", () => {
    const result = partitionCurriculum(interleaved);
    expect(result.coreLessons.map((item) => item.id)).toEqual([
      "core-1",
      "core-2",
      "core-3",
      "core-4",
    ]);
    expect(result.supplementalLessons.map((item) => item.id)).toEqual([
      "weekly-1",
      "weekly-2",
      "bonus-1",
    ]);
  });

  it("does not let an interleaved supplemental lesson block the CORE path", () => {
    const result = computeCurriculumStates(["core-1", "core-2"], interleaved);
    expect(result.stateById.get("core-3")).toMatchObject({
      unlocked: true,
      current: true,
    });
    expect(result.stateById.get("weekly-1")?.unlocked).toBe(false);
  });

  it("keeps the direct unlock helper aligned with the shared curriculum model", () => {
    expect(
      isLessonUnlocked("core-3", ["core-1", "core-2"], interleaved)
    ).toBe(true);
    expect(
      isLessonUnlocked("weekly-1", ["core-1", "core-2"], interleaved)
    ).toBe(false);
  });

  it("selects the current lesson only from CORE", () => {
    const result = computeCurriculumStates(["core-1"], interleaved);
    expect(result.states.filter((state) => state.current).map((state) => state.lesson.id)).toEqual([
      "core-2",
    ]);
  });

  it("keeps all supplemental categories visible but locked before CORE four", () => {
    const result = computeCurriculumStates(
      ["core-1", "core-2", "core-3", "weekly-1"],
      interleaved
    );
    expect(result.supplementalUnlocked).toBe(false);
    expect(result.supplementalStates).toHaveLength(3);
    expect(result.supplementalStates.every((state) => !state.unlocked)).toBe(true);
    // Stored approval remains true even though presentation must show locked.
    expect(result.stateById.get("weekly-1")?.completed).toBe(true);
    expect(result.supplementalGateLesson?.id).toBe("core-4");
  });

  it("unlocks every supplemental category once CORE four is complete", () => {
    const result = computeCurriculumStates(
      ["core-1", "core-2", "core-3", "core-4", "weekly-1"],
      interleaved
    );
    expect(result.supplementalUnlocked).toBe(true);
    expect(result.supplementalStates.every((state) => state.unlocked)).toBe(true);
    expect(result.stateById.get("weekly-1")?.completed).toBe(true);
  });

  it("numbers normalized CORE groups as one uninterrupted sequence", () => {
    expect(sectionLessonNumber("core-3", interleaved)).toBe(3);
  });

  it("fails closed for supplemental content when fewer than four CORE lessons exist", () => {
    const short = [
      lesson("core-1", "CORE CONTENT"),
      lesson("core-2", "CORE CONTENT"),
      lesson("weekly-1", "PA BREAKDOWNS"),
    ];
    const result = computeCurriculumStates(["core-1", "core-2"], short);
    expect(result.supplementalGateLesson).toBeUndefined();
    expect(result.stateById.get("weekly-1")?.unlocked).toBe(false);
  });

  it("lets an admin access every existing lesson", () => {
    const result = computeCurriculumStates([], interleaved, true);
    expect(result.states.every((state) => state.unlocked)).toBe(true);
  });

  it("navigates CORE without entering supplemental categories", () => {
    const navigation = getLessonNavigation(
      "core-2",
      ["core-1", "core-2"],
      interleaved
    );
    expect(navigation.previous?.id).toBe("core-1");
    expect(navigation.next?.id).toBe("core-3");
  });

  it("keeps supplemental navigation inside its category and access gate", () => {
    const locked = getLessonNavigation(
      "weekly-1",
      ["core-1", "core-2"],
      interleaved
    );
    expect(locked.next).toBeUndefined();
    expect(locked.nextLocked?.id).toBe("weekly-2");
    expect(
      getLessonNavigation(
        "weekly-1",
        ["core-1", "core-2", "core-3", "core-4"],
        interleaved
      ).next?.id
    ).toBe("weekly-2");
  });
});

describe("curriculum ordering overrides", () => {
  it("reorders lessons within a section by order override", async () => {
    const { buildEffectiveLessons } = await import("./lessons-config");
    const result = buildEffectiveLessons([], {
      "lesson-1": { order: 1 },
      "lesson-2": { order: 0 },
    });
    expect(result.slice(0, 3).map((l) => l.id)).toEqual([
      "lesson-2",
      "lesson-1",
      "lesson-3",
    ]);
    // Data untouched — only positions move.
    const one = result.find((l) => l.id === "lesson-1");
    expect(one?.title).toBe("Introduction to Dojo");
    expect(one?.group).toBe("CORE CONTENT");
  });

  it("keeps other sections in source order and appends unordered lessons after ordered siblings", async () => {
    const { buildEffectiveLessons } = await import("./lessons-config");
    const added = [
      lesson("extra-1", "PA BREAKDOWNS"),
      lesson("extra-2", "PA BREAKDOWNS"),
      lesson("extra-3", "PA BREAKDOWNS"),
    ];
    const result = buildEffectiveLessons(added, {
      "extra-2": { order: 0 },
      "extra-1": { order: 1 },
      // extra-3 has no order — must land after the ordered pair.
    });
    expect(
      result.filter((l) => l.group === "PA BREAKDOWNS").map((l) => l.id)
    ).toEqual(["extra-2", "extra-1", "extra-3"]);
    // CORE untouched by another section's reorder.
    expect(result.slice(0, 3).map((l) => l.id)).toEqual([
      "lesson-1",
      "lesson-2",
      "lesson-3",
    ]);
  });

  it("changes the CORE gating sequence when CORE is reordered", async () => {
    const { buildEffectiveLessons } = await import("./lessons-config");
    const reordered = buildEffectiveLessons([], {
      "lesson-1": { order: 2 },
      "lesson-2": { order: 0 },
      "lesson-3": { order: 1 },
    });
    const states = computeCurriculumStates([], reordered);
    // New first CORE lesson is lesson-2 — it is the unlocked/current one.
    expect(states.stateById.get("lesson-2")).toMatchObject({
      unlocked: true,
      current: true,
    });
    expect(states.stateById.get("lesson-1")?.unlocked).toBe(false);
  });
});
