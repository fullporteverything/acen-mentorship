import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hashIp, reconcileAuditOutbox } from "@/lib/audit";
import { closeDatabase, db } from "@/lib/db/client";
import { auditEvents, auditOutbox } from "@/lib/db/schema";

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_USE_TEST_URL = "true";

afterAll(async () => closeDatabase());

describe("audit integrity", () => {
  it("pseudonymizes IP addresses deterministically without storing the source", () => {
    const hash = hashIp("203.0.113.9");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("203.0.113.9");
    expect(hashIp("203.0.113.9")).toBe(hash);
  });

  it.skipIf(!process.env.DATABASE_URL_TEST)("keeps audit rows append-only and reconciles the durable outbox", async () => {
    const action = `audit-test-${randomUUID()}`;
    const [event] = await db.insert(auditEvents).values({ action, resourceType: "test", details: {} }).returning();
    await expect(db.update(auditEvents).set({ action: `${action}-changed` }).where(eq(auditEvents.id, event.id))).rejects.toThrow();
    await expect(db.delete(auditEvents).where(eq(auditEvents.id, event.id))).rejects.toThrow();

    const [queued] = await db.insert(auditOutbox).values({ action, resourceType: "test", payload: { action, resourceType: "test" } }).returning();
    expect(await reconcileAuditOutbox()).toMatchObject({ delivered: expect.any(Number), failed: 0 });
    const [after] = await db.select().from(auditOutbox).where(eq(auditOutbox.id, queued.id));
    expect(after.deliveredAt).toBeInstanceOf(Date);
  }, 15_000);

  it.skipIf(!process.env.DATABASE_URL_TEST)("lets only one concurrent reconciler deliver an outbox event", async () => {
    const action = `audit-concurrent-${randomUUID()}`;
    const [queued] = await db.insert(auditOutbox).values({
      action, resourceType: "test", payload: { action, resourceType: "test" },
    }).returning();
    await Promise.all([reconcileAuditOutbox(), reconcileAuditOutbox(), reconcileAuditOutbox()]);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, action));
    expect(rows).toHaveLength(1);
    const [after] = await db.select().from(auditOutbox).where(eq(auditOutbox.id, queued.id));
    expect(after.deliveredAt).toBeInstanceOf(Date);
  }, 15_000);

  it.skipIf(!process.env.DATABASE_URL_TEST)("rolls back a failed delivery so the outbox event remains retryable", async () => {
    const validAction = `audit-retry-${randomUUID()}`;
    const [queued] = await db.insert(auditOutbox).values({
      action: validAction,
      resourceType: "test",
      payload: { action: "x".repeat(161), resourceType: "test" },
    }).returning();
    expect(await reconcileAuditOutbox()).toMatchObject({ failed: expect.any(Number) });
    const [failed] = await db.select().from(auditOutbox).where(eq(auditOutbox.id, queued.id));
    expect(failed.deliveredAt).toBeNull();

    await db.update(auditOutbox).set({ payload: { action: validAction, resourceType: "test" } }).where(eq(auditOutbox.id, queued.id));
    await reconcileAuditOutbox();
    const [retried] = await db.select().from(auditOutbox).where(eq(auditOutbox.id, queued.id));
    expect(retried.deliveredAt).toBeInstanceOf(Date);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, validAction))).toHaveLength(1);
  }, 15_000);
});
