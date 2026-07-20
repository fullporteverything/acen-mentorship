/**
 * Blob-backed persistence for the per-user Journal.
 *
 * Backed by a **private, OIDC-authenticated** Vercel Blob store: we pass
 * `storeId` (from BLOB_READ_WRITE_TOKEN_STORE_ID) and the runtime's
 * VERCEL_OIDC_TOKEN handles auth — there is no static read-write token. Writes
 * use `access: "private"`; reads go through the authenticated `get()` (private
 * blobs are NOT publicly fetchable by URL).
 *
 * Entries live under `dojo/journal/{discordId}.json` as an array, newest first.
 */

import { get, list, put } from "@vercel/blob";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;

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

// ---------------------------------------------------------------------------
// Low-level private-blob JSON helpers (OIDC via storeId)
// ---------------------------------------------------------------------------

async function readJson<T>(pathname: string, fallback: T): Promise<T> {
  try {
    const result = await get(pathname, {
      access: "private",
      storeId: STORE_ID,
      useCache: false, // stable pathnames are overwritten in place — read origin
    });
    if (!result || result.statusCode !== 200 || !result.stream) return fallback;
    const text = await new Response(result.stream).text();
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "private",
    storeId: STORE_ID,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
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
  const raw = await readJson<unknown>(journalPath(discordId), []);
  return normalizeEntries(raw);
}

export async function saveJournal(
  discordId: string,
  entries: JournalEntry[]
): Promise<void> {
  await writeJson(journalPath(discordId), entries);
}

/**
 * Every journal entry across every member, flattened newest-first for the
 * mentor view. Scans the `dojo/journal/` prefix and reads each member's blob
 * through the authenticated get() (private blobs).
 */
export async function getAllJournals(): Promise<AdminJournalEntry[]> {
  const { blobs } = await list({ prefix: "dojo/journal/", storeId: STORE_ID });
  const results: AdminJournalEntry[] = [];

  for (const blob of blobs) {
    if (!blob.pathname.endsWith(".json")) continue;
    const discordId = blob.pathname
      .replace("dojo/journal/", "")
      .replace(/\.json$/, "");

    try {
      const entries = normalizeEntries(
        await readJson<unknown>(blob.pathname, [])
      );
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
