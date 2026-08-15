import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDatabase, db } from "@/lib/db/client";
import { members, uploads } from "@/lib/db/schema";
import { archiveHomeworkSubmission, listHomeworkArchive, reviewArchivedHomework } from "@/lib/homework-archive";

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_USE_TEST_URL = "true";

afterAll(async () => closeDatabase());

describe.skipIf(!process.env.DATABASE_URL_TEST)("homework archive integration", () => {
  it("creates an auto-approved submission and its first review atomically", async () => {
    const token = randomUUID();
    const discordId = `auto-${token}`.slice(0, 32);
    const lessonId = `auto-lesson-${token}`;
    const lessonPosition = 1_000_000_000 + (Number.parseInt(token.replaceAll("-", "").slice(0, 8), 16) % 1_000_000_000);
    const storageKey = `dojo/homework/${discordId}/${token}.pdf`;
    await archiveHomeworkSubmission({
      discordId, lessonId, lessonTitle: "Auto Approval", lessonPosition,
      storageKey, fileName: "auto.pdf", initialDecision: "approved", initialFeedback: "Automatically approved",
    });
    const [owner] = await db.select({ id: members.id }).from(members).where(eq(members.discordId, discordId));
    await db.insert(uploads).values({ memberId: owner.id, storageKey, fileName: "auto.pdf", contentType: "application/pdf", byteSize: 10, status: "clean" });
    const page = await listHomeworkArchive({ discordIds: [discordId], limit: 10 });
    expect(page.items[0]).toMatchObject({ status: "approved", feedback: "Automatically approved" });
  }, 15_000);

  it("retains resubmissions and review history for linked identities", async () => {
    const token = randomUUID();
    const lessonPosition = 1_000_000_000 + (Number.parseInt(token.replaceAll("-", "").slice(0, 8), 16) % 1_000_000_000);
    const discordId = `archive-${token}`.slice(0, 32);
    const lessonId = `archive-lesson-${token}`;
    const firstKey = `dojo/homework/${discordId}/${token}-1.pdf`;
    const secondKey = `dojo/homework/${discordId}/${token}-2.pdf`;
    const first = await archiveHomeworkSubmission({ discordId, lessonId, lessonTitle: "Archive Test", lessonPosition, storageKey: firstKey, fileName: "first.pdf" });
    const second = await archiveHomeworkSubmission({ discordId, lessonId, lessonTitle: "Archive Test", lessonPosition, storageKey: secondKey, fileName: "second.pdf" });
    const [member] = await db.select({ id: members.id }).from(members).limit(1);
    const [owner] = await db.select({ id: members.id }).from(members).where(eq(members.discordId, discordId));
    expect(member).toBeTruthy();
    await db.insert(uploads).values([
      { memberId: owner.id, storageKey: firstKey, fileName: "first.pdf", contentType: "application/pdf", byteSize: 10, status: "clean" },
      { memberId: owner.id, storageKey: secondKey, fileName: "second.pdf", contentType: "application/pdf", byteSize: 10, status: "clean" },
    ]);
    await reviewArchivedHomework({ storageKey: firstKey, targetDiscordIds: [discordId], reviewerDiscordId: `reviewer-${token}`.slice(0, 32), decision: "approved", feedback: "Saved feedback" });

    const page = await listHomeworkArchive({ discordIds: [discordId], limit: 10 });
    expect(page.items.map((item) => item.version)).toEqual([second.version, first.version]);
    expect(page.items.find((item) => item.id === first.id)).toMatchObject({ status: "approved", feedback: "Saved feedback", available: true });
  }, 15_000);
});
