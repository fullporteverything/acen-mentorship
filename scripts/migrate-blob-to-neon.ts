import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { get, list } from "@vercel/blob";

import type { PlatformRecord, PlatformRepository } from "@/lib/repositories/types";

interface BlobListing {
  blobs: Array<{ pathname: string; uploadedAt?: Date }>;
  hasMore: boolean;
  cursor?: string;
}

interface ReadOnlyBlobClient {
  list(options: { prefix: string; cursor?: string }): Promise<BlobListing>;
  get(pathname: string): Promise<{ statusCode?: number; stream?: ReadableStream<Uint8Array> | null } | null>;
}

export interface ScanItemReport {
  sourcePath: string;
  status: "record" | "error" | "unsupported";
  reason?: "fetch_failed" | "parse_failed" | "unsupported_path" | "empty_object" | "missing_referenced_file";
}

export interface ManifestItem {
  record: PlatformRecord;
  checksum: string;
  validationError?: "missing" | "invalid" | "duplicate" | "missing_file";
}

export interface MigrationManifest {
  version: 1;
  checksum: string;
  items: ManifestItem[];
  counts: Record<string, number>;
}

export interface MigrationItemReport {
  family: PlatformRecord["family"];
  key: string;
  status: "imported" | "skipped" | "error";
  reason?: ManifestItem["validationError"] | "destination_read_failed" | "destination_write_failed";
  retryable?: boolean;
}

export interface MigrationReport {
  imported: number;
  skipped: number;
  errors: number;
  items: MigrationItemReport[];
}

function memberFromPath(pathname: string, prefix: string) {
  return decodeURIComponent(pathname.slice(prefix.length).replace(/\.json$/, ""));
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Read-only scanner for all mutable legacy `dojo/*` JSON records. */
export async function scanBlobRecords(
  client: ReadOnlyBlobClient,
  onItem: (item: ScanItemReport) => void = () => undefined
): Promise<PlatformRecord[]> {
  const blobs: BlobListing["blobs"] = [];
  let cursor: string | undefined;
  do {
    const page = await client.list({ prefix: "dojo/", cursor });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const records: PlatformRecord[] = [];
  const journalReferences: Array<{ sourcePath: string; memberId: string; image: string }> = [];
  const physicalFiles = new Set<string>();
  for (const blob of blobs.sort((left, right) => left.pathname.localeCompare(right.pathname))) {
    const sourcePath = blob.pathname;
    const updatedAt = (blob.uploadedAt ?? new Date(0)).toISOString();
    const homeworkFile = sourcePath.match(/^dojo\/homework\/([^/]+)\//);
    const journalFile = sourcePath.match(/^dojo\/journal\/([^/]+)\/[^/]+\//);
    if (!sourcePath.endsWith(".json") && (homeworkFile || journalFile)) {
      const encodedMemberId = homeworkFile?.[1] ?? journalFile?.[1];
      records.push({
        family: "file",
        key: sourcePath,
        memberId: encodedMemberId ? decodeURIComponent(encodedMemberId) : undefined,
        payload: { pathname: sourcePath },
        updatedAt,
        sourcePath,
      });
      physicalFiles.add(sourcePath);
      onItem({ sourcePath, status: "record" });
      continue;
    }
    if (!sourcePath.endsWith(".json")) { onItem({ sourcePath, status: "unsupported", reason: "unsupported_path" }); continue; }
    let result: Awaited<ReturnType<ReadOnlyBlobClient["get"]>>;
    try { result = await client.get(blob.pathname); }
    catch { onItem({ sourcePath, status: "error", reason: "fetch_failed" }); continue; }
    if (result?.statusCode !== 200 || !result.stream) { onItem({ sourcePath, status: "error", reason: "fetch_failed" }); continue; }
    let payload: unknown;
    try { payload = JSON.parse(await new Response(result.stream).text()); }
    catch { onItem({ sourcePath, status: "error", reason: "parse_failed" }); continue; }
    const add = (family: PlatformRecord["family"], key: string, memberId: string | undefined, value: unknown) => records.push({ family, key, memberId, payload: value as PlatformRecord["payload"], updatedAt, sourcePath });
    const before = records.length;

    if (/^dojo\/progress\/[^/]+\.json$/.test(sourcePath)) {
      const memberId = memberFromPath(sourcePath, "dojo/progress/");
      add("progress", memberId, memberId, payload);
      const submissions = asObject(payload).submissions;
      if (submissions && typeof submissions === "object") {
        for (const [lessonId, submission] of Object.entries(submissions as Record<string, unknown>)) add("homework", `${memberId}/${lessonId}`, memberId, submission);
      }
    }
    else if (/^dojo\/journal\/[^/]+\.json$/.test(sourcePath) && Array.isArray(payload)) {
      const memberId = memberFromPath(sourcePath, "dojo/journal/");
      for (const entry of payload) {
        const id = asObject(entry).id;
        if (typeof id === "string") {
          add("journal", `${memberId}/${id}`, memberId, entry);
          const images = asObject(entry).images;
          if (Array.isArray(images)) for (const image of images) if (typeof image === "string") journalReferences.push({ sourcePath, memberId, image });
        }
      }
    } else if (/^dojo\/security\/members\/[^/]+\.json$/.test(sourcePath)) {
      const memberId = memberFromPath(sourcePath, "dojo/security/members/"); add("security", memberId, memberId, payload);
    } else if (sourcePath === "dojo/announcements.json" && Array.isArray(payload)) {
      for (const announcement of payload) { const id = asObject(announcement).id; if (typeof id === "string") add("announcement", id, undefined, announcement); }
    } else if (/^dojo\/notifications-seen\/[^/]+\/[^/]+\.json$/.test(sourcePath)) {
      const [, memberId, filename] = sourcePath.match(/^dojo\/notifications-seen\/([^/]+)\/([^/]+)\.json$/) ?? [];
      if (memberId && filename) add("receipt", `${decodeURIComponent(memberId)}/${decodeURIComponent(filename)}`, decodeURIComponent(memberId), payload);
    } else if (/^dojo\/announcements-seen\/[^/]+\.json$/.test(sourcePath) && Array.isArray(payload)) {
      const memberId = memberFromPath(sourcePath, "dojo/announcements-seen/");
      for (const announcementId of payload) if (typeof announcementId === "string") add("receipt", `${memberId}/${announcementId}`, memberId, { seen: true });
    } else if (/^dojo\/watch-progress\/[^/]+\/[^/]+\/\d+\.json$/.test(sourcePath)) {
      const [, memberId, lessonId, checkpoint] = sourcePath.match(/^dojo\/watch-progress\/([^/]+)\/([^/]+)\/(\d+)\.json$/) ?? [];
      if (memberId && lessonId && checkpoint) add("watch", `${decodeURIComponent(memberId)}/${decodeURIComponent(lessonId)}/${checkpoint}`, decodeURIComponent(memberId), payload);
    } else if (/^dojo\/profile\/[^/]+\.json$/.test(sourcePath)) {
      const memberId = memberFromPath(sourcePath, "dojo/profile/"); add("profile", memberId, memberId, payload);
    } else if (sourcePath === "dojo/settings.json") add("settings", "global", undefined, payload);
    else if (sourcePath === "dojo/lesson-overrides.json") add("lesson_override", "global", undefined, payload);
    else if (sourcePath === "dojo/added-lessons.json") add("added_lesson", "global", undefined, payload);
    else if (sourcePath === "dojo/added-sections.json") add("added_section", "global", undefined, payload);
    else if (/^dojo\/caption-requests\/[^/]+\.json$/.test(sourcePath)) add("caption_request", memberFromPath(sourcePath, "dojo/caption-requests/"), undefined, payload);
    if (records.length === before) onItem({ sourcePath, status: "unsupported", reason: "empty_object" });
    else for (let index = before; index < records.length; index++) onItem({ sourcePath, status: "record" });
  }
  for (const reference of journalReferences) {
    if (!physicalFiles.has(reference.image)) onItem({ sourcePath: reference.sourcePath, status: "error", reason: "missing_referenced_file" });
  }
  return records;
}

export async function scanBlobReport(client: ReadOnlyBlobClient): Promise<{ records: PlatformRecord[]; items: ScanItemReport[] }> {
  const items: ScanItemReport[] = [];
  const records = await scanBlobRecords(client, (item) => items.push(item));
  return { records, items };
}

/**
 * Read legacy Blob data only. This function never calls `put`, `del`, or any
 * other mutation API; it is safe for a production Blob dry run.
 */
export async function scanConfiguredBlobRecords(): Promise<PlatformRecord[]> {
  return (await scanConfiguredBlobReport()).records;
}

export async function scanConfiguredBlobReport(): Promise<{ records: PlatformRecord[]; items: ScanItemReport[] }> {
  const storeId = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  return scanBlobReport({
    list: (options) => list({ ...options, storeId, oidcToken }),
    get: (pathname) => get(pathname, { access: "private", storeId, oidcToken, useCache: false }),
  });
}

export function assertScanImportable(scan: { items: ScanItemReport[] }, allowUnsupportedPaths: string[] = []): void {
  if (scan.items.some((item) => item.status === "error" || (item.status === "unsupported" && !allowUnsupportedPaths.includes(item.sourcePath)))) {
    throw new Error("Blob scan contains blocking errors or unsupported paths; import refused");
  }
}

export function normalizeForChecksum(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(normalizeForChecksum).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${normalizeForChecksum(nested)}`)
      .join(",")}}`;
  }
  throw new Error("invalid");
}

function checksum(value: unknown) {
  return createHash("sha256").update(normalizeForChecksum(value)).digest("hex");
}

function checksumRecord(record: PlatformRecord) {
  return checksum({
    family: record.family,
    key: record.key,
    memberId: record.memberId ?? null,
    payload: record.payload,
    updatedAt: record.updatedAt,
    sourcePath: record.sourcePath ?? null,
  });
}

function validate(record: PlatformRecord, seen: Set<string>, fileKeys: Set<string>): ManifestItem["validationError"] | undefined {
  const identifier = `${record.family}:${record.key}`;
  if (seen.has(identifier)) return "duplicate";
  seen.add(identifier);
  if (!record.key || (["progress", "homework", "journal", "security", "receipt", "watch", "profile"] as string[]).includes(record.family) && !record.memberId) return "missing";
  try {
    normalizeForChecksum(record);
  } catch {
    return "invalid";
  }
  const submissions = (record.payload as { submissions?: Record<string, { blobUrl?: unknown }> }).submissions;
  if (submissions && Object.values(submissions).some((submission) => typeof submission.blobUrl === "string" && !fileKeys.has(submission.blobUrl))) return "missing_file";
  return undefined;
}

export function buildManifest(records: PlatformRecord[]): MigrationManifest {
  const ordered = [...records].sort((left, right) => `${left.family}:${left.key}`.localeCompare(`${right.family}:${right.key}`));
  const fileKeys = new Set(ordered.filter((record) => record.family === "file").map((record) => record.key));
  const seen = new Set<string>();
  const items = ordered.map((record) => {
    let recordChecksum = "";
    try { recordChecksum = checksumRecord(record); } catch { recordChecksum = "invalid"; }
    return { record, checksum: recordChecksum, validationError: validate(record, seen, fileKeys) };
  });
  const counts = Object.fromEntries(items.reduce((families, item) => families.set(item.record.family, (families.get(item.record.family) ?? 0) + 1), new Map<string, number>()));
  return { version: 1, checksum: checksum(items.map(({ checksum: itemChecksum }) => itemChecksum)), items, counts };
}

export async function importManifest(manifest: MigrationManifest, destination: PlatformRepository): Promise<MigrationReport> {
  const items: MigrationItemReport[] = [];
  let imported = 0;
  let skipped = 0;
  if (manifest.items.some((item) => item.validationError)) {
    return {
      imported,
      skipped,
      errors: manifest.items.filter((item) => item.validationError).length,
      items: manifest.items.map((item) => ({
        family: item.record.family,
        key: item.record.key,
        status: "error" as const,
        reason: item.validationError ?? "invalid",
      })),
    };
  }
  for (const item of manifest.items) {
    let existing: PlatformRecord | null;
    try {
      existing = await destination.get(item.record.family, item.record.key);
    } catch {
      items.push({ family: item.record.family, key: item.record.key, status: "error", reason: "destination_read_failed", retryable: true });
      continue;
    }
    if (existing?.sourceChecksum === item.checksum) {
      skipped++;
      items.push({ family: item.record.family, key: item.record.key, status: "skipped" });
      continue;
    }
    try {
      await destination.put({ ...item.record, sourceChecksum: item.checksum });
    } catch {
      items.push({ family: item.record.family, key: item.record.key, status: "error", reason: "destination_write_failed", retryable: true });
      continue;
    }
    imported++;
    items.push({ family: item.record.family, key: item.record.key, status: "imported" });
  }
  return { imported, skipped, errors: items.filter((item) => item.status === "error").length, items };
}

/**
 * The only configured importer. Test URL selection is explicit and the
 * database client otherwise refuses to use DATABASE_URL_TEST.
 */
export async function importConfiguredBlobToIsolatedNeon(options?: { allowUnsupportedPaths?: string[] }): Promise<{
  manifest: MigrationManifest;
  report: MigrationReport;
}>;
export async function importConfiguredBlobToIsolatedNeon(options: { allowUnsupportedPaths?: string[] } = {}): Promise<{
  manifest: MigrationManifest;
  report: MigrationReport;
}> {
  if (process.env.NODE_ENV === "production" || process.env.DATABASE_USE_TEST_URL !== "true") {
    throw new Error("DATABASE_USE_TEST_URL=true is required for an isolated Neon import");
  }
  const { PostgresRepository } = await import("@/lib/repositories/postgres-repository");
  const scan = await scanConfiguredBlobReport();
  assertScanImportable(scan, options.allowUnsupportedPaths);
  const manifest = buildManifest(scan.records);
  const report = await importManifest(manifest, new PostgresRepository());
  return { manifest, report };
}

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const mode = process.argv[2] ?? "--dry-run";
  if (mode === "--dry-run") {
    const scan = await scanConfiguredBlobReport();
    const manifest = buildManifest(scan.records);
    console.log(JSON.stringify({ mode: "dry-run", counts: manifest.counts, itemCount: manifest.items.length, invalidItems: manifest.items.filter((item) => item.validationError).length, scanErrors: scan.items.filter((item) => item.status === "error").length, unsupportedItems: scan.items.filter((item) => item.status === "unsupported").length }));
    return;
  }
  if (mode === "--import-isolated") {
    const { manifest, report } = await importConfiguredBlobToIsolatedNeon();
    console.log(JSON.stringify({ mode: "import-isolated", counts: manifest.counts, imported: report.imported, skipped: report.skipped, errors: report.errors }));
    return;
  }
  throw new Error("Usage: migrate-blob-to-neon.ts [--dry-run|--import-isolated]");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/migrate-blob-to-neon.ts")) {
  void main();
}
