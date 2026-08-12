import { get, list, put } from "@vercel/blob";

import type { PlatformRecord, PlatformRecordFamily, PlatformRepository } from "./types";

export interface PersistentBlobStore {
  get(pathname: string): Promise<PlatformRecord | null>;
  list(prefix: string): Promise<PlatformRecord[]>;
  put(pathname: string, record: PlatformRecord): Promise<void>;
}

/** Vercel Blob implementation; no delete operation is exposed by this boundary. */
export class VercelBlobStore implements PersistentBlobStore {
  private readonly storeId = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;
  private readonly oidcToken = process.env.VERCEL_OIDC_TOKEN;

  async get(pathname: string): Promise<PlatformRecord | null> {
    const result = await get(pathname, { access: "private", storeId: this.storeId, oidcToken: this.oidcToken, useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as PlatformRecord;
  }

  async list(prefix: string): Promise<PlatformRecord[]> {
    const records: PlatformRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, storeId: this.storeId, oidcToken: this.oidcToken });
      for (const blob of page.blobs) {
        const record = await this.get(blob.pathname);
        if (record) records.push(record);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return records;
  }

  async put(pathname: string, record: PlatformRecord): Promise<void> {
    await put(pathname, JSON.stringify(record), {
      access: "private", storeId: this.storeId, oidcToken: this.oidcToken,
      contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
    });
  }
}

/**
 * Persistent Vercel Blob adapter. Existing legacy source paths are retained
 * whenever supplied; repository-created records use a private namespace.
 */
export class BlobRepository implements PlatformRepository {
  readonly backend = "blob" as const;
  constructor(private readonly store: PersistentBlobStore = new VercelBlobStore()) {}

  async get(family: PlatformRecordFamily, key: string): Promise<PlatformRecord | null> {
    return this.store.get(this.pathFor(family, key));
  }

  async list(family?: PlatformRecordFamily): Promise<PlatformRecord[]> {
    return (await this.store.list(family ? `dojo/repository-v1/${family}/` : "dojo/repository-v1/"))
      .filter((record) => family === undefined || record.family === family)
      .sort((left, right) => `${left.family}:${left.key}`.localeCompare(`${right.family}:${right.key}`));
  }

  async put(record: PlatformRecord): Promise<PlatformRecord> {
    // Never serialize a repository envelope over a legacy source object.
    await this.store.put(this.pathFor(record.family, record.key), record);
    return record;
  }

  /** Explicit read-only compatibility bridge for legacy source records. */
  async readLegacy(sourcePath: string): Promise<PlatformRecord | null> {
    return this.store.get(sourcePath);
  }

  private pathFor(family: PlatformRecordFamily, key: string) {
    return `dojo/repository-v1/${family}/${encodeURIComponent(key)}.json`;
  }
}
