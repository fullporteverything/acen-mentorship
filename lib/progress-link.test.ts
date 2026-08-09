import { describe, expect, it } from "vitest";
import { progressViewerIds } from "./progress-link";

describe("progressViewerIds", () => {
  it("links the configured main account and preview alt in both directions", () => {
    expect(progressViewerIds("main-id", "main-id")).toEqual([
      "main-id",
      "1417619259252801546",
    ]);
    expect(progressViewerIds("1417619259252801546", "main-id")).toEqual([
      "1417619259252801546",
      "main-id",
    ]);
  });

  it("leaves every student account isolated", () => {
    expect(progressViewerIds("student-id", "main-id")).toEqual(["student-id"]);
  });
});
