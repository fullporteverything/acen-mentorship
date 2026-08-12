import { createHmac, randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { migrationRuns, migrationVerificationArtifacts } from "@/lib/db/schema";
import { buildManifest, type MigrationManifest } from "@/scripts/migrate-blob-to-neon";

import { PostgresRepository } from "./postgres-repository";
import type { PlatformRecord } from "./types";

const MAX_VERIFICATION_AGE_MS = 30 * 60 * 1000;

/** Pure structural check retained for unit coverage; it is never cutover authority. */
export interface TrustedVerificationArtifact {
  sourceManifestChecksum: string;
  destinationManifestChecksum: string;
  mismatchCount: number;
  expiresAt: Date | null;
}

export function isTrustedVerificationArtifact(artifact: TrustedVerificationArtifact | null): boolean {
  return Boolean(
    artifact &&
      artifact.mismatchCount === 0 &&
      artifact.sourceManifestChecksum === artifact.destinationManifestChecksum &&
      artifact.expiresAt &&
      artifact.expiresAt > new Date()
  );
}

type PersistedRun = {
  id: string;
  sourceManifest: MigrationManifest;
  sourceManifestChecksum: string;
  sourceScope: string;
};

interface PersistedArtifact extends PersistedRun {
  destinationManifestChecksum: string;
  mismatchCount: number;
  expiresAt: Date | null;
  verificationSeal: string | null;
}

function verifierSecret(): string | null {
  return process.env.MIGRATION_VERIFIER_SECRET?.trim() || null;
}

function sealFor(artifact: Pick<PersistedArtifact, "id" | "sourceManifestChecksum" | "destinationManifestChecksum" | "mismatchCount" | "expiresAt">): string | null {
  const secret = verifierSecret();
  if (!secret || !artifact.expiresAt) return null;
  return createHmac("sha256", secret)
    .update([artifact.id, artifact.sourceManifestChecksum, artifact.destinationManifestChecksum, artifact.mismatchCount, artifact.expiresAt.toISOString()].join("\n"))
    .digest("hex");
}

function deriveSourceScope(manifest: MigrationManifest): string | null {
  const paths = manifest.items.map((item) => item.record.sourcePath).filter((path): path is string => Boolean(path));
  if (paths.length !== manifest.items.length || paths.length === 0) return null;
  const directories = paths.map((path) => path.split("/").slice(0, -1));
  const common = directories[0].filter((part, index) => directories.every((directory) => directory[index] === part));
  return common.length ? `${common.join("/")}/` : null;
}

function isMigrationManifest(value: unknown): value is MigrationManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<MigrationManifest>;
  return typeof manifest.checksum === "string" && Array.isArray(manifest.items) && Boolean(manifest.counts);
}

/**
 * Only the verifier invokes this after a successful exact manifest comparison.
 * The run stores immutable source evidence; the HMAC prevents database-only
 * inserts from becoming cutover authority.
 */
export async function persistVerifiedManifest(manifest: MigrationManifest, destinationManifest: MigrationManifest): Promise<void> {
  const sourceScope = deriveSourceScope(manifest);
  const secret = verifierSecret();
  if (!sourceScope) throw new Error("Verified migration requires a non-empty common source scope");
  if (!secret) throw new Error("MIGRATION_VERIFIER_SECRET is required to persist cutover verification evidence");
  if (manifest.checksum !== destinationManifest.checksum) throw new Error("Cannot persist mismatched migration verification evidence");

  const runId = randomUUID();
  const expiresAt = new Date(Date.now() + MAX_VERIFICATION_AGE_MS);
  const seal = sealFor({
    id: runId,
    sourceManifestChecksum: manifest.checksum,
    destinationManifestChecksum: destinationManifest.checksum,
    mismatchCount: 0,
    expiresAt,
  });
  if (!seal) throw new Error("Could not seal migration verification evidence");

  await db.transaction(async (tx) => {
    await tx.insert(migrationRuns).values({
      id: runId,
      name: `verified-blob-import-${runId}`,
      source: "verifier",
      status: "verified",
      completedAt: new Date(),
      sourceManifest: manifest,
      sourceManifestChecksum: manifest.checksum,
      sourceScope,
    });
    await tx.insert(migrationVerificationArtifacts).values({
      id: runId,
      runId,
      sourceManifestChecksum: manifest.checksum,
      destinationManifestChecksum: destinationManifest.checksum,
      mismatchCount: 0,
      verifiedAt: new Date(),
      expiresAt,
      verificationSeal: seal,
    });
  });
}

async function loadLatestArtifact(): Promise<PersistedArtifact | null> {
  const [artifact] = await db
    .select({
      id: migrationVerificationArtifacts.id,
      runId: migrationVerificationArtifacts.runId,
      sourceManifestChecksum: migrationVerificationArtifacts.sourceManifestChecksum,
      destinationManifestChecksum: migrationVerificationArtifacts.destinationManifestChecksum,
      mismatchCount: migrationVerificationArtifacts.mismatchCount,
      expiresAt: migrationVerificationArtifacts.expiresAt,
      verificationSeal: migrationVerificationArtifacts.verificationSeal,
      sourceManifest: migrationRuns.sourceManifest,
      runManifestChecksum: migrationRuns.sourceManifestChecksum,
      sourceScope: migrationRuns.sourceScope,
    })
    .from(migrationVerificationArtifacts)
    .innerJoin(migrationRuns, eq(migrationVerificationArtifacts.runId, migrationRuns.id))
    // The newest evidence is authoritative; an expired or forged newer
    // artifact must block cutover instead of falling back to stale evidence.
    .orderBy(desc(migrationVerificationArtifacts.createdAt), desc(migrationVerificationArtifacts.id))
    .limit(1);

  if (!artifact || !artifact.runId || !artifact.sourceScope || !artifact.runManifestChecksum || !isMigrationManifest(artifact.sourceManifest)) return null;
  return {
    id: artifact.id,
    sourceManifest: artifact.sourceManifest,
    sourceManifestChecksum: artifact.sourceManifestChecksum,
    destinationManifestChecksum: artifact.destinationManifestChecksum,
    mismatchCount: artifact.mismatchCount,
    expiresAt: artifact.expiresAt,
    verificationSeal: artifact.verificationSeal,
    sourceScope: artifact.sourceScope,
  };
}

function isWellSealed(artifact: PersistedArtifact): boolean {
  const expectedSeal = sealFor(artifact);
  return Boolean(
    expectedSeal &&
      artifact.verificationSeal === expectedSeal &&
      artifact.mismatchCount === 0 &&
      artifact.expiresAt &&
      artifact.expiresAt > new Date() &&
      artifact.sourceManifestChecksum === artifact.sourceManifest.checksum &&
      artifact.destinationManifestChecksum === artifact.sourceManifest.checksum
  );
}

async function currentScopedDestinationManifest(scope: string): Promise<MigrationManifest> {
  const repository = new PostgresRepository();
  const records = (await repository.list()).filter((record: PlatformRecord) => record.sourcePath?.startsWith(scope));
  return buildManifest(records);
}

function sameCounts(left: MigrationManifest["counts"], right: MigrationManifest["counts"]): boolean {
  const families = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...families].every((family) => (left[family] ?? 0) === (right[family] ?? 0));
}

/** Loads verifier-sealed evidence and independently verifies the current destination before cutover. */
export async function hasCurrentTrustedVerificationArtifact(): Promise<boolean> {
  const artifact = await loadLatestArtifact();
  if (!artifact || !isWellSealed(artifact)) return false;
  const current = await currentScopedDestinationManifest(artifact.sourceScope);
  return current.checksum === artifact.destinationManifestChecksum && sameCounts(current.counts, artifact.sourceManifest.counts);
}
