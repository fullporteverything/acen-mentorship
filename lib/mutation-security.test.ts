import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedRoutes = [
  "app/api/admin/add-lesson/route.ts",
  "app/api/admin/announcements/route.ts",
  "app/api/admin/homework/route.ts",
  "app/api/admin/journal-feedback/route.ts",
  "app/api/admin/lesson-overrides/route.ts",
  "app/api/admin/progress/route.ts",
  "app/api/admin/section/route.ts",
  "app/api/admin/settings/route.ts",
  "app/api/admin/unlock-all/route.ts",
  "app/api/admin/video-captions/route.ts",
  "app/api/admin/video-upload-url/route.ts",
  "app/api/announcements/seen/route.ts",
  "app/api/notifications/route.ts",
  "app/api/profile/effect/route.ts",
  "app/api/security/acknowledge/route.ts",
];

describe("sensitive mutation coverage", () => {
  it.each(guardedRoutes)("keeps %s behind the shared persistent mutation boundary", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("allowMutation(");
  });

  it("keeps high-frequency and upload routes behind explicit persistent limits", () => {
    for (const path of [
      "app/api/lessons/watch-progress/route.ts",
      "app/api/lessons/submit-homework/route.ts",
      "app/api/security/log-capture/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toMatch(/allowMutation\(|consumeRateLimit\(/);
    }
  });
});
