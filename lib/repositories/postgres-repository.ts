import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { legacyBlobRecords } from "@/lib/db/schema";

import type { PlatformRecord, PlatformRecordFamily, PlatformRepository } from "./types";

function rowToRecord(row: typeof legacyBlobRecords.$inferSelect): PlatformRecord {
  return {
    family: row.family as PlatformRecordFamily,
    key: row.recordKey,
    memberId: row.memberDiscordId ?? undefined,
    payload: row.payload as PlatformRecord["payload"],
    updatedAt: row.sourceUpdatedAt.toISOString(),
    sourcePath: row.sourcePath ?? undefined,
    sourceChecksum: row.sourceChecksum,
  };
}

/** Postgres staging adapter. It is never selected without verified migration. */
export class PostgresRepository implements PlatformRepository {
  readonly backend = "postgres" as const;

  async get(family: PlatformRecordFamily, key: string): Promise<PlatformRecord | null> {
    const [row] = await db
      .select()
      .from(legacyBlobRecords)
      .where(and(eq(legacyBlobRecords.family, family), eq(legacyBlobRecords.recordKey, key)))
      .limit(1);
    return row ? rowToRecord(row) : null;
  }

  async list(family?: PlatformRecordFamily): Promise<PlatformRecord[]> {
    const query = db.select().from(legacyBlobRecords).orderBy(asc(legacyBlobRecords.family), asc(legacyBlobRecords.recordKey));
    const rows = family ? await query.where(eq(legacyBlobRecords.family, family)) : await query;
    return rows.map(rowToRecord);
  }

  async put(record: PlatformRecord): Promise<PlatformRecord> {
    await db
      .insert(legacyBlobRecords)
      .values({
        family: record.family,
        recordKey: record.key,
        memberDiscordId: record.memberId,
        payload: record.payload,
        sourcePath: record.sourcePath,
        sourceChecksum: record.sourceChecksum ?? "",
        sourceUpdatedAt: new Date(record.updatedAt),
      })
      .onConflictDoUpdate({
        target: [legacyBlobRecords.family, legacyBlobRecords.recordKey],
        set: {
          memberDiscordId: record.memberId,
          payload: record.payload,
          sourcePath: record.sourcePath,
          sourceChecksum: record.sourceChecksum ?? "",
          sourceUpdatedAt: new Date(record.updatedAt),
          updatedAt: new Date(),
        },
      });
    return record;
  }
}
