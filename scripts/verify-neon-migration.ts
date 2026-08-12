import { buildManifest, type MigrationManifest } from "./migrate-blob-to-neon";
import { persistVerifiedManifest } from "@/lib/repositories/trusted-verification";
import type { PlatformRepository } from "@/lib/repositories/types";

export interface VerificationReport {
  verified: boolean;
  countMismatches: Array<{ family: string; expected: number; actual: number }>;
  checksumMismatches: Array<{ family: string; key: string }>;
}

export async function verifyManifest(manifest: MigrationManifest, destination: PlatformRepository): Promise<VerificationReport> {
  // Verification is scoped to this manifest/run. Other restart-safe migration
  // runs may legitimately share the staging repository.
  const actualRecords = (await Promise.all(
    manifest.items.map((item) => destination.get(item.record.family, item.record.key))
  )).filter((record): record is NonNullable<typeof record> => record !== null);
  const actual = buildManifest(actualRecords);
  const families = new Set([...Object.keys(manifest.counts), ...Object.keys(actual.counts)]);
  const countMismatches = [...families]
    .filter((family) => (manifest.counts[family] ?? 0) !== (actual.counts[family] ?? 0))
    .map((family) => ({ family, expected: manifest.counts[family] ?? 0, actual: actual.counts[family] ?? 0 }));
  const actualChecksums = new Map(actual.items.map((item) => [`${item.record.family}:${item.record.key}`, item.checksum]));
  const checksumMismatches = manifest.items
    .filter((item) => !item.validationError && actualChecksums.get(`${item.record.family}:${item.record.key}`) !== item.checksum)
    .map((item) => ({ family: item.record.family, key: item.record.key }));
  const report = { verified: countMismatches.length === 0 && checksumMismatches.length === 0, countMismatches, checksumMismatches };
  if (report.verified && destination.backend === "postgres") await persistVerifiedManifest(manifest, actual);
  return report;
}
