import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { members, orphanedUploads, uploadQuarantine, uploads } from "@/lib/db/schema";
import type { ScanResult } from "@/lib/malware-scan";

export async function recordUploadMetadata(discordId: string, storageKey: string, file: File, scan: ScanResult): Promise<void> {
  const [member] = await db.select({ id: members.id }).from(members).where(eq(members.discordId, discordId)).limit(1);
  if (!member) throw new Error("Missing Postgres member metadata for upload");
  const [upload] = await db.insert(uploads).values({
    memberId: member.id, storageKey, fileName: file.name || "upload", contentType: file.type || "application/octet-stream", byteSize: file.size,
    // No configured scanner means the upload is accepted unscanned and viewable;
    // only a real "infected" verdict quarantines it.
    status: scan.state === "infected" ? "quarantined" : "clean",
  }).onConflictDoNothing().returning({ id: uploads.id });
  if (upload && scan.state === "infected") {
    await db.insert(uploadQuarantine).values({ uploadId: upload.id, reason: "scan_detected" }).onConflictDoNothing();
  }
}

/** Records the already-written private Blob when follow-up metadata fails. */
export async function recordOrphanedUpload(discordId: string, storageKey: string, file: File, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [member] = await tx.select({ id: members.id }).from(members).where(eq(members.discordId, discordId)).limit(1);
    if (!member) throw new Error("Cannot record orphan without member metadata");
    const [existing] = await tx.select({ id: uploads.id }).from(uploads).where(eq(uploads.storageKey, storageKey)).limit(1);
    const [upload] = existing
      ? await tx.update(uploads).set({ status: "orphaned", updatedAt: new Date() }).where(eq(uploads.id, existing.id)).returning({ id: uploads.id })
      : await tx.insert(uploads).values({
          memberId: member.id, storageKey, fileName: file.name || "upload", contentType: file.type || "application/octet-stream", byteSize: file.size, status: "orphaned",
        }).returning({ id: uploads.id });
    await tx.insert(orphanedUploads).values({ uploadId: upload.id, reason }).onConflictDoNothing();
  });
}

/** All private homework/journal paths must have tracked clean metadata. */
export async function isUploadAvailable(storageKey: string, ownerDiscordIds?: string[]): Promise<boolean> {
  const [upload] = await db
    .select({ status: uploads.status })
    .from(uploads)
    .innerJoin(members, eq(uploads.memberId, members.id))
    .where(and(
      eq(uploads.storageKey, storageKey),
      ownerDiscordIds?.length ? inArray(members.discordId, ownerDiscordIds) : undefined
    ))
    .limit(1);
  return upload?.status === "clean";
}
