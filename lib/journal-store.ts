/**
 * Blob-backed persistence for the per-user Journal.
 *
 * Entries live under `dojo/journal/{discordId}.json` as an array, newest first.
 * Same conventions as lesson-store: stable pathnames + cache-busted reads.
 *
 * Each entry can carry a single mentor `feedback` note (set from the admin
 * panel) which the member sees attached to that specific entry.
 */

import { list, put } from "@vercel/blob";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  mood: string;
  createdAt: string;
  /** Cached Discord display name, so the mentor view can show who wrote it. */
  discordUsername?: string;
  /** Mentor's feedback on this entry (empty/undefined until they leave one). */
  feedback?: string;
  /** ISO timestamp of when the feedback was last saved. */
  feedbackAt?: string;
}

/** A journal entry flattened with the member it belongs to — for the mentor view. */
export interface AdminJournalEntry extends JournalEntry {
  discordId: string;
  discordUsername: string;
}

function journalPath(discordId: string): string {
  return `dojo/journal/${discordId}.json`;
}

async function resolveBlobUrl(pathname: string): Promise<string | null> {
  const { blobs } = await list({ prefix: pathname, token: TOKEN });
  const match = blobs.find((b) => b.pathname === pathname);
  return match?.url ?? null;
}

/** Defensive parse of a raw journal blob into well-shaped entries. */
function normalizeEntries(raw: unknown): JournalEntry[] {
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
      discordUsername:
        typeof e.discordUsername === "string" ? e.discordUsername : undefined,
      feedback: typeof e.feedback === "string" ? e.feedback : undefined,
      feedbackAt: typeof e.feedbackAt === "string" ? e.feedbackAt : undefined,
    }));
}

export async function getJournal(discordId: string): Promise<JournalEntry[]> {
  try {
    const url = await resolveBlobUrl(journalPath(discordId));
    if (!url) return [];
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return [];
    return normalizeEntries(await res.json());
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

/**
 * Every journal entry across every member, flattened newest-first for the
 * mentor view. Scans the `dojo/journal/` prefix and reads each member's blob.
 */
export async function getAllJournals(): Promise<AdminJournalEntry[]> {
  const { blobs } = await list({ prefix: "dojo/journal/", token: TOKEN });
  const results: AdminJournalEntry[] = [];

  for (const blob of blobs) {
    if (!blob.pathname.endsWith(".json")) continue;
    const discordId = blob.pathname
      .replace("dojo/journal/", "")
      .replace(/\.json$/, "");

    try {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) continue;
      const entries = normalizeEntries(await res.json());
      const username =
        entries.find((e) => e.discordUsername)?.discordUsername || discordId;
      for (const e of entries) {
        results.push({ ...e, discordId, discordUsername: username });
      }
    } catch {
      // Skip unreadable/corrupt journal blobs rather than failing the whole list.
    }
  }

  results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return results;
}

/**
 * Set (or clear) the mentor feedback on one specific entry of a member's
 * journal. Returns false if that entry no longer exists.
 */
export async function setEntryFeedback(
  discordId: string,
  entryId: string,
  feedback: string
): Promise<boolean> {
  const entries = await getJournal(discordId);
  const idx = entries.findIndex((e) => e.id === entryId);
  if (idx === -1) return false;

  const trimmed = feedback.trim();
  entries[idx] = {
    ...entries[idx],
    feedback: trimmed || undefined,
    feedbackAt: trimmed ? new Date().toISOString() : undefined,
  };
  await saveJournal(discordId, entries);
  return true;
}
