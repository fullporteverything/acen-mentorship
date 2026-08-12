import { normalizeForChecksum } from "@/scripts/migrate-blob-to-neon";

import type { PlatformRecord, PlatformRecordFamily, PlatformRepository, ShadowMismatch } from "./types";

function canonical(record: PlatformRecord) {
  return normalizeForChecksum({ family: record.family, key: record.key, memberId: record.memberId ?? null, payload: record.payload, updatedAt: record.updatedAt });
}

/** Blob is authoritative. Shadow failures/divergence are recorded, never thrown to Blob callers. */
export class DualRepository implements PlatformRepository {
  readonly backend = "dual" as const;
  private readonly mismatches = new Map<string, ShadowMismatch>();

  constructor(private readonly blob: PlatformRepository, private readonly postgres: PlatformRepository) {}

  async get(family: PlatformRecordFamily, key: string): Promise<PlatformRecord | null> {
    const blobRecord = await this.blob.get(family, key);
    try { this.replaceComparison(family, key, blobRecord, await this.postgres.get(family, key)); }
    catch { this.set({ family, key, reason: "shadow_failure" }); }
    return blobRecord;
  }

  async list(family?: PlatformRecordFamily): Promise<PlatformRecord[]> {
    const blobRecords = await this.blob.list(family);
    try {
      const postgresRecords = await this.postgres.list(family);
      const all = new Map<string, [PlatformRecord | null, PlatformRecord | null]>();
      for (const record of blobRecords) all.set(`${record.family}:${record.key}`, [record, null]);
      for (const record of postgresRecords) {
        const id = `${record.family}:${record.key}`;
        all.set(id, [all.get(id)?.[0] ?? null, record]);
      }
      for (const [id, [fromBlob, fromPostgres]] of all) {
        const [recordFamily, ...keyParts] = id.split(":");
        this.replaceComparison(recordFamily as PlatformRecordFamily, keyParts.join(":"), fromBlob, fromPostgres);
      }
    } catch {
      for (const record of blobRecords) this.set({ family: record.family, key: record.key, reason: "shadow_failure" });
    }
    return blobRecords;
  }

  async put(record: PlatformRecord): Promise<PlatformRecord> {
    const stored = await this.blob.put(record);
    try {
      await this.postgres.put(stored);
      this.clear(stored.family, stored.key);
    } catch {
      this.set({ family: stored.family, key: stored.key, reason: "shadow_failure" });
    }
    return stored;
  }

  async reconcile(family: PlatformRecordFamily, key: string): Promise<boolean> {
    const authoritative = await this.blob.get(family, key);
    if (!authoritative) return false;
    try { await this.postgres.put(authoritative); this.clear(family, key); return true; }
    catch { this.set({ family, key, reason: "shadow_failure" }); return false; }
  }

  async getMismatches(): Promise<ShadowMismatch[]> { return [...this.mismatches.values()]; }

  private replaceComparison(family: PlatformRecordFamily, key: string, blobRecord: PlatformRecord | null, postgresRecord: PlatformRecord | null) {
    if (!blobRecord && !postgresRecord) return this.clear(family, key);
    if (!blobRecord || !postgresRecord) return this.set({ family, key, reason: "missing" });
    if (canonical(blobRecord) !== canonical(postgresRecord)) return this.set({ family, key, reason: "payload_mismatch" });
    this.clear(family, key);
  }
  private set(mismatch: ShadowMismatch) { this.mismatches.set(`${mismatch.family}:${mismatch.key}`, mismatch); }
  private clear(family: PlatformRecordFamily, key: string) { this.mismatches.delete(`${family}:${key}`); }
}
