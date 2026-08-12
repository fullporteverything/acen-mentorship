import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BlobRepository, type PersistentBlobStore } from "./blob-repository";
import { DualRepository } from "./dual-repository";
import { getRepository } from "./index";
import { exercisePlatformRepository } from "./shared-contract";
import { isTrustedVerificationArtifact } from "./trusted-verification";
import type { PlatformRecord, PlatformRepository } from "./types";

class MemoryRepository implements PlatformRepository {
  readonly backend = "postgres" as const;
  private readonly records = new Map<string, PlatformRecord>();

  async get(family: PlatformRecord["family"], key: string) {
    return this.records.get(`${family}:${key}`) ?? null;
  }

  async list(family?: PlatformRecord["family"]) {
    return [...this.records.values()]
      .filter((record) => !family || record.family === family)
      .sort((left, right) => `${left.family}:${left.key}`.localeCompare(`${right.family}:${right.key}`));
  }

  async put(record: PlatformRecord) {
    this.records.set(`${record.family}:${record.key}`, record);
    return record;
  }
}

class PersistentFixtureBlobStore implements PersistentBlobStore {
  private readonly values = new Map<string, PlatformRecord>();
  async get(pathname: string) { return this.values.get(pathname) ?? null; }
  async list(prefix: string) { return [...this.values.entries()].filter(([pathname]) => pathname.startsWith(prefix)).map(([, record]) => record); }
  async put(pathname: string, record: PlatformRecord) { this.values.set(pathname, record); }
  has(pathname: string) { return this.values.has(pathname); }
}

const records: PlatformRecord[] = [
  { family: "member", key: "member-1", memberId: "member-1", payload: { displayName: "Member" }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "progress", key: "member-1", memberId: "member-1", payload: { completedLessons: ["lesson-1"] }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "homework", key: "member-1/lesson-1/1", memberId: "member-1", payload: { status: "pending", fileName: "homework.pdf" }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "journal", key: "member-1/entry-1", memberId: "member-1", payload: { body: "entry" }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "security", key: "member-1", memberId: "member-1", payload: { strikes: 1 }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "announcement", key: "announcement-1", payload: { title: "News" }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "receipt", key: "member-1/announcement-1", memberId: "member-1", payload: { seenAt: "2026-01-01T00:00:00.000Z" }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "watch", key: "member-1/lesson-1/80", memberId: "member-1", payload: { percent: 80 }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "profile", key: "member-1", memberId: "member-1", payload: { effect: "ember" }, updatedAt: "2026-01-01T00:00:00.000Z" },
];
const orderedRecords = [...records].sort((left, right) => `${left.family}:${left.key}`.localeCompare(`${right.family}:${right.key}`));

describe("PlatformRepository contract", () => {
  it("runs the same member/progress/homework/journal/security/announcement/receipt/watch operations against Blob and Postgres adapters", async () => {
    const blob = new BlobRepository(new PersistentFixtureBlobStore());
    const postgres = new MemoryRepository();

    for (const repository of [blob, postgres]) {
      const result = await exercisePlatformRepository(repository, records);
      expect(result.listed).toEqual(orderedRecords);
      expect(result.loaded).toEqual(orderedRecords);
      await expect(repository.get("homework", "member-1/lesson-1/1")).resolves.toMatchObject({ payload: { status: "pending" } });
      await expect(repository.get("receipt", "member-1/announcement-1")).resolves.toMatchObject({ memberId: "member-1" });
    }
  });

  it("persists Blob records across adapter restarts and surfaces storage failure", async () => {
    const store = new PersistentFixtureBlobStore();
    const legacy = { ...records[0], sourcePath: "dojo/progress/member-1.json" };
    await store.put(legacy.sourcePath, legacy);
    await new BlobRepository(store).put(legacy);
    expect(store.has(legacy.sourcePath)).toBe(true);
    await expect(new BlobRepository(store).get("member", "member-1")).resolves.toEqual(legacy);
    await expect(new BlobRepository(store).readLegacy(legacy.sourcePath)).resolves.toEqual(legacy);
    const failedStore: PersistentBlobStore = { get: store.get.bind(store), list: store.list.bind(store), put: async () => { throw new Error("write failed"); } };
    await expect(new BlobRepository(failedStore).put(records[0])).rejects.toThrow("write failed");
  });

  it("dual writes preserve Blob as the read source and safely report a shadow mismatch", async () => {
    const blob = new BlobRepository(new PersistentFixtureBlobStore());
    const postgres = new MemoryRepository();
    const dual = new DualRepository(blob, postgres);
    await dual.put(records[0]);
    await postgres.put({ ...records[0], payload: { displayName: "Different" } });

    await expect(dual.get("member", "member-1")).resolves.toMatchObject({ payload: { displayName: "Member" } });
    expect(await dual.getMismatches()).toEqual([
      expect.objectContaining({ family: "member", key: "member-1", reason: "payload_mismatch" }),
    ]);
  });

  it("detects Postgres-only records and does not fail Blob writes when shadow persistence fails", async () => {
    const blob = new BlobRepository(new PersistentFixtureBlobStore());
    const postgres = new MemoryRepository();
    await postgres.put(records[0]);
    const dual = new DualRepository(blob, postgres);
    await expect(dual.list()).resolves.toEqual([]);
    expect(await dual.getMismatches()).toEqual([expect.objectContaining({ reason: "missing" })]);

    const failingShadow: PlatformRepository = {
      backend: "postgres",
      get: postgres.get.bind(postgres),
      list: postgres.list.bind(postgres),
      put: async () => { throw new Error("shadow unavailable"); },
    };
    const safeDual = new DualRepository(blob, failingShadow);
    await expect(safeDual.put(records[1])).resolves.toEqual(records[1]);
    expect(await safeDual.getMismatches()).toEqual([expect.objectContaining({ reason: "shadow_failure" })]);
  });

  it("keeps Blob selected by default, always permits dual, and rejects forged/replayed verification evidence", async () => {
    await expect(getRepository("blob")).resolves.toMatchObject({ backend: "blob" });
    await expect(getRepository("dual")).resolves.toMatchObject({ backend: "dual" });
    expect(isTrustedVerificationArtifact({ sourceManifestChecksum: "source", destinationManifestChecksum: "forged", mismatchCount: 0, expiresAt: null })).toBe(false);
    expect(isTrustedVerificationArtifact({ sourceManifestChecksum: "same", destinationManifestChecksum: "same", mismatchCount: 0, expiresAt: new Date(0) })).toBe(false);
    expect(isTrustedVerificationArtifact({ sourceManifestChecksum: "same", destinationManifestChecksum: "same", mismatchCount: 1, expiresAt: null })).toBe(false);
  });
});
