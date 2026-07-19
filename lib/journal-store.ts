/**
 * Blob-backed persistence for the per-user Journal.
 *
 * Entries live under `dojo/journal/{discordId}.json` as an array, newest first.
 * Same conventions as lesson-store: stable pathnames + cache-busted reads.
 */

import { list, put } from "@vercel/blob";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  mood: string;
  createdAt: string;
}

function journalPath(discordId: string): string {
  return `dojo/journal/${discordId}.json`;
}

async function resolveBlobUrl(pathname: string): Promise<string | null> {
  const { blobs } = await list({ prefix: pathname, token: TOKEN });
  const match = blobs.find((b) => b.pathname === pathname);
  return match?.url ?? null;
}

export async function getJournal(discordId: string): Promise<JournalEntry[]> {
  try {
    const url = await resolveBlobUrl(journalPath(discordId));
    if (!url) return [];
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (e): e is JournalEntry =>
          !!e &&
          typeof e === "object" &&
          typeof (e as JournalEntry).id === "string" &&
          typeof (e as JournalEntry).body === "string"
      )
      .map((e) => ({
        id: e.id,
        title: typeof e.title === "string" ? e.title : "",
        body: e.body,
        mood: typeof e.mood === "string" ? e.mood : "",
        createdAt:
          typeof e.createdAt === "string" ? e.createdAt : new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

export async function saveJournal(
  discordId: string,
  entries: JournalEntry[]
): Promise<void> {
  await put(journalPath(discordId), JSON.stringify(entries, null, 2), {
    access: "public",
    token: TOKEN,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}
