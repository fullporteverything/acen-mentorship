import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { auditEvents, auditOutbox, members } from "@/lib/db/schema";

export type AuditEvent = {
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  actorDiscordId?: string;
  memberDiscordId?: string;
  ip?: string;
};

export function hashIp(ip: string | undefined): string | undefined {
  return ip ? createHash("sha256").update(ip).digest("hex") : undefined;
}

/** Never tell a Blob caller to retry after its write has succeeded: queue audit reconciliation. */
export async function recordBlobAuditSafely(event: AuditEvent): Promise<void> {
  await reconcileAuditOutbox(25).catch(() => undefined);
  try {
    await recordAuditEvent(event);
  } catch {
    await db.insert(auditOutbox).values({ action: event.action, resourceType: event.resourceType, resourceId: event.resourceId, payload: event }).catch(() => undefined);
  }
}

/** Retry durable audit records left behind after a successful Blob mutation. */
export async function reconcileAuditOutbox(limit = 50): Promise<{ delivered: number; failed: number }> {
  const pending = await db
    .select()
    .from(auditOutbox)
    .where(isNull(auditOutbox.deliveredAt))
    .orderBy(asc(auditOutbox.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)));
  let delivered = 0;
  let failed = 0;
  for (const pendingItem of pending) {
    try {
      const wasDelivered = await db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(auditOutbox)
          .where(and(eq(auditOutbox.id, pendingItem.id), isNull(auditOutbox.deliveredAt)))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!item) return false;
        const event = item.payload as AuditEvent;
        const ids = [event.actorDiscordId, event.memberDiscordId].filter((id): id is string => Boolean(id));
        const rows = ids.length
          ? await tx.select({ id: members.id, discordId: members.discordId }).from(members).where(inArray(members.discordId, ids))
          : [];
        const byDiscord = new Map(rows.map((row) => [row.discordId, row.id]));
        await tx.insert(auditEvents).values({
          actorMemberId: event.actorDiscordId ? byDiscord.get(event.actorDiscordId) : undefined,
          memberId: event.memberDiscordId ? byDiscord.get(event.memberDiscordId) : undefined,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          details: { ...event.details, ipHash: hashIp(event.ip) },
        });
        const deliveredAt = new Date();
        await tx.update(auditOutbox).set({ deliveredAt, updatedAt: deliveredAt }).where(eq(auditOutbox.id, item.id));
        return true;
      });
      if (wasDelivered) delivered += 1;
    } catch {
      failed += 1;
    }
  }
  return { delivered, failed };
}

/** Append-only audit writer with actor/target and irreversible IP pseudonymization. */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  const ids = [event.actorDiscordId, event.memberDiscordId].filter((id): id is string => Boolean(id));
  const rows = ids.length ? await db.select({ id: members.id, discordId: members.discordId }).from(members).where(inArray(members.discordId, ids)) : [];
  const byDiscord = new Map(rows.map((row) => [row.discordId, row.id]));
  await db.insert(auditEvents).values({
    actorMemberId: event.actorDiscordId ? byDiscord.get(event.actorDiscordId) : undefined,
    memberId: event.memberDiscordId ? byDiscord.get(event.memberDiscordId) : undefined,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    details: { ...event.details, ipHash: hashIp(event.ip) },
  });
}
