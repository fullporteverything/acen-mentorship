import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Shared with the @vercel/blob mock so the test can assert on the same ids.
const fixture = vi.hoisted(() => {
  const token = `backfill-${Math.random().toString(36).slice(2, 10)}`;
  const discordId = token.slice(0, 32);
  const lessonId = `${token}-lesson`;
  const storageKey = `dojo/homework/${discordId}/${token}.pdf`;
  return {
    discordId,
    lessonId,
    storageKey,
    progressPath: `dojo/progress/${discordId}.json`,
    progress: {
      discordUsername: "Legacy Student",
      completedLessons: [],
      submissions: {
        [lessonId]: {
          blobUrl: storageKey,
          fileName: "legacy.pdf",
          submittedAt: "2025-01-02T03:04:05.000Z",
          status: "approved",
          feedback: "Nice work.",
          reviewedAt: "2025-01-03T00:00:00.000Z",
        },
      },
    },
  };
});

// Only the legacy progress blob resolves; every other path falls back so the
// lesson-overrides/added-lessons reads return their empty defaults.
vi.mock("@vercel/blob", () => ({
  list: async ({ prefix }: { prefix: string }) =>
    prefix === "dojo/progress/" ? { blobs: [{ pathname: fixture.progressPath }] } : { blobs: [] },
  get: async (pathname: string) =>
    pathname === fixture.progressPath
      ? { statusCode: 200, stream: new Response(JSON.stringify(fixture.progress)).body }
      : null,
  put: async () => ({}),
}));

import { closeDatabase, db } from "@/lib/db/client";
import { homeworkSubmissions } from "@/lib/db/schema";
import { backfillLegacyArchive, listHomeworkArchive } from "@/lib/homework-archive";

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_USE_TEST_URL = "true";

afterAll(async () => closeDatabase());

describe.skipIf(!process.env.DATABASE_URL_TEST)("backfillLegacyArchive", () => {
  it("imports Blob-only submissions and preserves the original submittedAt", async () => {
    const first = await backfillLegacyArchive();
    expect(first.imported).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select({ submittedAt: homeworkSubmissions.submittedAt })
      .from(homeworkSubmissions)
      .where(eq(homeworkSubmissions.storageKey, fixture.storageKey))
      .limit(1);
    expect(row?.submittedAt?.toISOString()).toBe("2025-01-02T03:04:05.000Z");

    const page = await listHomeworkArchive({ discordIds: [fixture.discordId], limit: 10 });
    const item = page.items.find((entry) => entry.lessonId === fixture.lessonId);
    expect(item).toMatchObject({ status: "approved", available: true });
  }, 15_000);

  it("is idempotent — a second run imports nothing and skips the existing row", async () => {
    const again = await backfillLegacyArchive();
    expect(again.imported).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(1);
  }, 15_000);
});
