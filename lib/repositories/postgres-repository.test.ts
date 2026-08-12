import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_USE_TEST_URL = "true";
process.env.MIGRATION_VERIFIER_SECRET = "isolated-test-verifier-secret";

import { closeDatabase, db } from "@/lib/db/client";
import { legacyBlobRecords, migrationRuns, migrationVerificationArtifacts } from "@/lib/db/schema";
import { buildManifest, importManifest } from "@/scripts/migrate-blob-to-neon";
import { verifyManifest } from "@/scripts/verify-neon-migration";

import { PostgresRepository } from "./postgres-repository";
import { getRepository } from "./index";
import { exercisePlatformRepository } from "./shared-contract";
import type { PlatformRecord } from "./types";

const runId = randomUUID();
const records = ([
  { family: "member", key: `fixture-${runId}/member`, memberId: `fixture-${runId}`, payload: { displayName: "Fixture" }, updatedAt: "2026-01-01T00:00:00.000Z", sourcePath: "fixture/member.json" },
  {
    family: "progress",
    key: `fixture-${runId}/progress`,
    memberId: `fixture-${runId}`,
    payload: { completedLessons: ["fixture-lesson"], submissions: {} },
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourcePath: "fixture/progress.json",
  },
  { family: "homework", key: `fixture-${runId}/homework`, memberId: `fixture-${runId}`, payload: { status: "pending", fileName: "fixture.pdf" }, updatedAt: "2026-01-02T00:00:00.000Z", sourcePath: "fixture/homework.json" },
  { family: "security", key: `fixture-${runId}/security`, memberId: `fixture-${runId}`, payload: { strikes: 1 }, updatedAt: "2026-01-02T00:00:00.000Z", sourcePath: "fixture/security.json" },
  { family: "announcement", key: `fixture-${runId}/announcement`, payload: { title: "Fixture" }, updatedAt: "2026-01-02T00:00:00.000Z", sourcePath: "fixture/announcement.json" },
  { family: "receipt", key: `fixture-${runId}/receipt`, memberId: `fixture-${runId}`, payload: { seenAt: "2026-01-02T00:00:00.000Z" }, updatedAt: "2026-01-02T00:00:00.000Z", sourcePath: "fixture/receipt.json" },
  { family: "watch", key: `fixture-${runId}/watch`, memberId: `fixture-${runId}`, payload: { percent: 80 }, updatedAt: "2026-01-02T00:00:00.000Z", sourcePath: "fixture/watch.json" },
  { family: "profile", key: `fixture-${runId}/profile`, memberId: `fixture-${runId}`, payload: { effect: "ember" }, updatedAt: "2026-01-02T00:00:00.000Z", sourcePath: "fixture/profile.json" },
  {
    family: "journal",
    key: `fixture-${runId}/journal`,
    memberId: `fixture-${runId}`,
    payload: { id: "fixture-entry", body: "fixture journal" },
    updatedAt: "2026-01-02T00:00:00.000Z",
    sourcePath: "fixture/journal.json",
  },
] as PlatformRecord[]).map((record) => ({ ...record, sourcePath: `fixture-${runId}/${record.sourcePath}` }));

describe.sequential("PostgresRepository isolated migration import", () => {
  afterAll(async () => {
    await db.delete(legacyBlobRecords).where(inArray(legacyBlobRecords.recordKey, records.map((record) => record.key)));
    await closeDatabase();
  });

  it("imports fixture manifests idempotently and verifies per-family count/checksum parity", async () => {
    if (!process.env.DATABASE_URL_TEST) throw new Error("DATABASE_URL_TEST is required for isolated migration integration tests");
    const repository = new PostgresRepository();
    const contract = await exercisePlatformRepository(repository, records);
    expect(contract.listed).toEqual(contract.expected);
    expect(contract.loaded).toEqual(contract.expected);
    const manifest = buildManifest(records);

    const first = await importManifest(manifest, repository);
    const rerun = await importManifest(manifest, repository);
    const verification = await verifyManifest(manifest, repository);

    expect(first).toMatchObject({ imported: records.length, errors: 0 });
    expect(rerun).toMatchObject({ imported: 0, skipped: records.length, errors: 0 });
    expect(verification).toMatchObject({ verified: true, countMismatches: [], checksumMismatches: [] });
  });

  it("permits Postgres only after fresh verifier evidence and rejects a changed scoped destination", async () => {
    const repository = new PostgresRepository();
    const manifest = buildManifest(records);

    await db.insert(migrationRuns).values({ id: runId, name: `forged-${runId}`, source: "forged", status: "verified" });
    await db.insert(migrationVerificationArtifacts).values({
      id: runId,
      runId,
      sourceManifestChecksum: manifest.checksum,
      destinationManifestChecksum: manifest.checksum,
      mismatchCount: 0,
      expiresAt: new Date(Date.now() + 60_000),
      verificationSeal: "fabricated",
    });
    await expect(getRepository("postgres")).rejects.toThrow("trusted persisted verification artifact");
    await verifyManifest(manifest, repository);
    expect(buildManifest((await repository.list()).filter((record) => record.sourcePath?.startsWith(`fixture-${runId}/`))).checksum).toBe(manifest.checksum);
    await expect(getRepository("postgres")).resolves.toMatchObject({ backend: "postgres" });
    const [verifiedArtifact] = await db
      .select({ id: migrationVerificationArtifacts.id, runId: migrationVerificationArtifacts.runId })
      .from(migrationVerificationArtifacts)
      .where(eq(migrationVerificationArtifacts.sourceManifestChecksum, manifest.checksum))
      .orderBy(desc(migrationVerificationArtifacts.createdAt));
    await expect(
      db.update(migrationRuns).set({ sourceScope: "forged/" }).where(eq(migrationRuns.id, verifiedArtifact.runId))
    ).rejects.toThrow();
    await expect(db.delete(migrationRuns).where(eq(migrationRuns.id, verifiedArtifact.runId))).rejects.toThrow();
    await expect(
      db.delete(migrationVerificationArtifacts).where(eq(migrationVerificationArtifacts.id, verifiedArtifact.id))
    ).rejects.toThrow();

    await repository.put({ ...records[0], payload: { displayName: "changed after verification" } });
    await expect(getRepository("postgres")).rejects.toThrow("trusted persisted verification artifact");

    await repository.put(records[0]);
    await verifyManifest(manifest, repository);
    await db.delete(legacyBlobRecords).where(eq(legacyBlobRecords.recordKey, records[1].key));
    await expect(getRepository("postgres")).rejects.toThrow("trusted persisted verification artifact");

    await repository.put(records[1]);
    await verifyManifest(manifest, repository);
    const injected = { ...records[0], key: `fixture-${runId}/added-after-verify`, sourcePath: `fixture-${runId}/fixture/added-after-verify.json` };
    await repository.put(injected);
    await expect(getRepository("postgres")).rejects.toThrow("trusted persisted verification artifact");

    await db.delete(legacyBlobRecords).where(eq(legacyBlobRecords.recordKey, injected.key));
    await verifyManifest(manifest, repository);
    const beforeRenewal = await db
      .select({ id: migrationVerificationArtifacts.id })
      .from(migrationVerificationArtifacts)
      .where(eq(migrationVerificationArtifacts.sourceManifestChecksum, manifest.checksum));
    await verifyManifest(manifest, repository);
    const afterRenewal = await db
      .select({ id: migrationVerificationArtifacts.id })
      .from(migrationVerificationArtifacts)
      .where(eq(migrationVerificationArtifacts.sourceManifestChecksum, manifest.checksum));
    expect(afterRenewal).toHaveLength(beforeRenewal.length + 1);
    await expect(getRepository("postgres")).resolves.toMatchObject({ backend: "postgres" });

    const expiredRunId = randomUUID();
    const expiredAt = new Date(Date.now() - 31 * 60 * 1000);
    await db.insert(migrationRuns).values({ id: expiredRunId, name: `forged-${expiredRunId}`, source: "forged", status: "verified" });
    await db.insert(migrationVerificationArtifacts).values({
      id: expiredRunId,
      runId: expiredRunId,
      sourceManifestChecksum: manifest.checksum,
      destinationManifestChecksum: manifest.checksum,
      mismatchCount: 0,
      verifiedAt: expiredAt,
      expiresAt: new Date(expiredAt.getTime() + 1_000),
      verificationSeal: "expired-fabricated",
    });
    await expect(getRepository("postgres")).rejects.toThrow("trusted persisted verification artifact");
  }, 25_000);
});
