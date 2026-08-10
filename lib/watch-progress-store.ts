import "server-only";

import { get, list, put, type ListBlobResultBlob } from "@vercel/blob";
import type { WatchProgress } from "./watch-progress";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;

function userPrefix(discordId: string): string {
  return `dojo/watch-progress/${encodeURIComponent(discordId)}/`;
}

function lessonPrefix(discordId: string, lessonId: string): string {
  return `${userPrefix(discordId)}${encodeURIComponent(lessonId)}/`;
}

function checkpointPath(
  discordId: string,
  lessonId: string,
  percent: number
): string {
  const checkpoint = String(Math.max(0, Math.min(100, Math.round(percent)))).padStart(
    3,
    "0"
  );
  return `${lessonPrefix(discordId, lessonId)}${checkpoint}.json`;
}

function checkpointPercent(pathname: string): number {
  const match = pathname.match(/\/(\d{3})\.json$/);
  return match ? Number(match[1]) : -1;
}

async function listAll(prefix: string): Promise<ListBlobResultBlob[]> {
  const blobs: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, storeId: STORE_ID });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

async function readCheckpoint(
  blob: ListBlobResultBlob
): Promise<WatchProgress | null> {
  try {
    const result = await get(blob.pathname, {
      access: "private",
      storeId: STORE_ID,
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const value = JSON.parse(
      await new Response(result.stream).text()
    ) as WatchProgress;
    return typeof value.percent === "number" &&
      typeof value.currentTime === "number" &&
      typeof value.duration === "number" &&
      typeof value.completed === "boolean" &&
      typeof value.updatedAt === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function highestCheckpoint(
  blobs: ListBlobResultBlob[]
): ListBlobResultBlob | undefined {
  return blobs.reduce<ListBlobResultBlob | undefined>((highest, blob) => {
    if (!highest) return blob;
    return checkpointPercent(blob.pathname) > checkpointPercent(highest.pathname)
      ? blob
      : highest;
  }, undefined);
}

export async function getWatchProgress(
  discordId: string,
  lessonId: string
): Promise<WatchProgress | null> {
  try {
    const highest = highestCheckpoint(
      await listAll(lessonPrefix(discordId, lessonId))
    );
    return highest ? await readCheckpoint(highest) : null;
  } catch {
    return null;
  }
}

export async function getWatchProgressByLesson(
  discordId: string
): Promise<Record<string, WatchProgress>> {
  try {
    const prefix = userPrefix(discordId);
    const grouped = new Map<string, ListBlobResultBlob[]>();
    for (const blob of await listAll(prefix)) {
      const relative = blob.pathname.slice(prefix.length);
      const slash = relative.indexOf("/");
      if (slash <= 0 || checkpointPercent(blob.pathname) < 0) continue;
      const lessonId = decodeURIComponent(relative.slice(0, slash));
      grouped.set(lessonId, [...(grouped.get(lessonId) || []), blob]);
    }
    const entries = await Promise.all(
      Array.from(grouped.entries()).map(async ([lessonId, blobs]) => {
        const highest = highestCheckpoint(blobs);
        const progress = highest ? await readCheckpoint(highest) : null;
        return progress ? ([lessonId, progress] as const) : null;
      })
    );
    return Object.fromEntries(entries.filter((entry) => entry !== null));
  } catch {
    return {};
  }
}

/**
 * Percentage checkpoints are immutable across percentages. A late 20% save
 * cannot overwrite an existing 80% save, even when Vercel handles them on
 * different instances; readers always select the highest checkpoint.
 */
export async function saveWatchProgress(
  discordId: string,
  lessonId: string,
  progress: WatchProgress
): Promise<void> {
  await put(
    checkpointPath(discordId, lessonId, progress.percent),
    JSON.stringify(progress, null, 2),
    {
      access: "private",
      storeId: STORE_ID,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    }
  );
}
