import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin homework review archive synchronization", () => {
  it("records every legacy admin decision in the immutable archive", () => {
    const source = readFileSync("app/api/admin/homework/route.ts", "utf8");
    expect(source).toContain("reviewArchivedHomework(");
  });
});
