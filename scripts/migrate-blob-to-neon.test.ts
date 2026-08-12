import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertScanImportable, buildManifest, importManifest, normalizeForChecksum, scanBlobRecords, scanBlobReport } from "./migrate-blob-to-neon";
import { verifyManifest } from "./verify-neon-migration";
import type { PlatformRecord, PlatformRepository } from "@/lib/repositories/types";

class FixtureRepository implements PlatformRepository {
  readonly backend = "blob" as const;
  private readonly values = new Map<string, PlatformRecord>();

  constructor(records: PlatformRecord[]) {
    for (const record of records) this.values.set(`${record.family}:${record.key}`, record);
  }
  async get(family: PlatformRecord["family"], key: string) { return this.values.get(`${family}:${key}`) ?? null; }
  async list(family?: PlatformRecord["family"]) { return [...this.values.values()].filter((record) => !family || record.family === family); }
  async put(record: PlatformRecord) { this.values.set(`${record.family}:${record.key}`, record); return record; }
}

const complete: PlatformRecord[] = [
  { family: "progress", key: "member-1", memberId: "member-1", payload: { completedLessons: ["lesson-1"], submissions: {} }, updatedAt: "2026-01-01T00:00:00.000Z" },
  { family: "journal", key: "member-1/entry-1", memberId: "member-1", payload: { body: "trade", tags: ["Eval"] }, updatedAt: "2026-01-02T00:00:00.000Z" },
];

describe("restart-safe Blob to Neon migration", () => {
  it("scans every legacy mutable Blob family read-only into stable logical records", async () => {
    const bodies: Record<string, unknown> = {
      "dojo/progress/member-1.json": { completedLessons: ["lesson-1"], submissions: { "lesson-1": { blobUrl: "dojo/homework/member-1/lesson-1/fixture.pdf" } } },
      "dojo/journal/member-1.json": [{ id: "entry-1", body: "trade", images: ["dojo/journal/member-1/entry-1/fixture.png"], createdAt: "2026-01-01T00:00:00.000Z" }],
      "dojo/security/members/member-1.json": { strikes: 1 },
      "dojo/announcements.json": [{ id: "announcement-1", title: "News" }],
      "dojo/notifications-seen/member-1/announcement-1.json": { seenAt: "2026-01-01T00:00:00.000Z" },
      "dojo/announcements-seen/member-1.json": ["announcement-1"],
      "dojo/caption-requests/video-1.json": { acquiredAt: "2026-01-01T00:00:00.000Z" },
      "dojo/watch-progress/member-1/lesson-1/080.json": { percent: 80 },
      "dojo/profile/member-1.json": { effect: "ember" },
      "dojo/settings.json": { autoApprove: false },
      "dojo/lesson-overrides.json": { "lesson-1": { title: "Override" } },
      "dojo/added-lessons.json": [{ id: "lesson-2" }],
      "dojo/added-sections.json": [{ id: "section-2" }],
      "dojo/homework/member-1/lesson-1/fixture.pdf": null,
      "dojo/journal/member-1/entry-1/fixture.png": null,
    };
    const paths = Object.keys(bodies);
    const records = await scanBlobRecords({
      async list() { return { blobs: paths.map((pathname) => ({ pathname, uploadedAt: new Date("2026-01-01") })), hasMore: false }; },
      async get(pathname: string) { return { statusCode: 200, stream: new Response(JSON.stringify(bodies[pathname])).body }; },
    });

    expect(records.map((record) => record.family).sort()).toEqual([
      "added_lesson", "added_section", "announcement", "caption_request", "file", "file", "homework", "journal", "lesson_override", "profile", "progress", "receipt", "receipt", "security", "settings", "watch",
    ]);
    expect(records.every((record) => record.sourcePath?.startsWith("dojo/"))).toBe(true);
  });

  it("reports every listed source as a record, explicit unsupported path, or explicit read/parse error", async () => {
    const paths = ["dojo/unknown.json", "dojo/progress/broken.json", "dojo/profile/unreadable.json"];
    const report = await scanBlobReport({
      async list() { return { blobs: paths.map((pathname) => ({ pathname })), hasMore: false }; },
      async get(pathname: string) {
        if (pathname.includes("broken")) return { statusCode: 200, stream: new Response("not json").body };
        if (pathname.includes("unreadable")) throw new Error("unavailable");
        return { statusCode: 200, stream: new Response("{}").body };
      },
    });
    expect(report.records).toEqual([]);
    expect(report.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "dojo/unknown.json", status: "unsupported" }),
      expect.objectContaining({ sourcePath: "dojo/progress/broken.json", status: "error", reason: "parse_failed" }),
      expect.objectContaining({ sourcePath: "dojo/profile/unreadable.json", status: "error", reason: "fetch_failed" }),
    ]));
  });

  it("reports a journal image reference as blocking when no physical Blob object exists", async () => {
    const report = await scanBlobReport({
      async list() { return { blobs: [{ pathname: "dojo/journal/member-1.json" }], hasMore: false }; },
      async get() { return { statusCode: 200, stream: new Response(JSON.stringify([{ id: "entry-1", images: ["dojo/journal/member-1/entry-1/missing.png"] }])).body }; },
    });
    expect(report.items).toContainEqual(expect.objectContaining({ status: "error", reason: "missing_referenced_file" }));
    expect(report.records.filter((record) => record.family === "file")).toEqual([]);
  });

  it("refuses configured import inputs with scan errors or unallowlisted unsupported paths", () => {
    expect(() => assertScanImportable({ items: [{ sourcePath: "dojo/broken.json", status: "error", reason: "parse_failed" }] })).toThrow("import refused");
    expect(() => assertScanImportable({ items: [{ sourcePath: "dojo/future.json", status: "unsupported", reason: "unsupported_path" }] })).toThrow("import refused");
    expect(() => assertScanImportable({ items: [{ sourcePath: "dojo/future.json", status: "unsupported", reason: "unsupported_path" }] }, ["dojo/future.json"])).not.toThrow();
  });
  it("creates order-independent normalized checksums and imports a complete fixture idempotently", async () => {
    expect(normalizeForChecksum({ b: 1, a: ["x"] })).toBe('{"a":["x"],"b":1}');
    const manifest = buildManifest([...complete].reverse());
    const destination = new FixtureRepository([]);
    const first = await importManifest(manifest, destination);
    const rerun = await importManifest(manifest, destination);

    expect(first.imported).toBe(2);
    expect(rerun.skipped).toBe(2);
    expect(await verifyManifest(manifest, destination)).toMatchObject({ verified: true, countMismatches: [], checksumMismatches: [] });
  });

  it.each([
    ["partial", [{ ...complete[0], memberId: undefined }], "missing"],
    ["corrupt", [{ ...complete[0], payload: { unsupported: BigInt(1) } }], "invalid"],
    ["duplicated", [complete[0], complete[0]], "duplicate"],
    ["missing-file", [{ ...complete[0], payload: { submissions: { "lesson-1": { blobUrl: "dojo/homework/missing.pdf" } } } }], "missing_file"],
  ])("reports %s fixture anomalies without mutating destination", async (_name, records, expectedReason) => {
    const destination = new FixtureRepository([]);
    const manifest = buildManifest(records as PlatformRecord[]);
    const report = await importManifest(manifest, destination);

    expect(report.items.some((item) => item.status === "error" && item.reason === expectedReason)).toBe(true);
    expect(await destination.list()).toEqual([]);
  });

  it("reports per-item retryable destination failures and resumes after partial writes", async () => {
    const manifest = buildManifest(complete);
    const destination = new FixtureRepository([]);
    const originalPut = destination.put.bind(destination);
    let failOnce = true;
    destination.put = async (record) => {
      if (failOnce && record.family === "journal") {
        failOnce = false;
        throw new Error("temporary database outage");
      }
      return originalPut(record);
    };

    const partial = await importManifest(manifest, destination);
    expect(partial).toMatchObject({ imported: 1, errors: 1 });
    expect(partial.items).toContainEqual(expect.objectContaining({ reason: "destination_write_failed", retryable: true }));
    await expect(importManifest(manifest, destination)).resolves.toMatchObject({ imported: 1, skipped: 1, errors: 0 });
  });
});
