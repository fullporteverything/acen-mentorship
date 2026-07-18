/**
 * Blob-backed persistence for the lessons system.
 *
 * Everything lives under the `dojo/` prefix in a single Vercel Blob store:
 *   - dojo/progress/{discordId}.json  — per-user homework progress
 *   - dojo/settings.json              — site-wide settings (auto-approve)
 *   - dojo/announcements.json         — announcement feed
 *   - dojo/homework/{discordId}/...   — the uploaded homework PDFs
 *
 * Reads resolve a blob's public URL via `list()` (so we never have to hardcode
 * the store's base host) and then fetch it with cache-busting, since we write
 * to stable, non-suffixed pathnames and would otherwise risk stale CDN copies.
 */

import { list, put } from "@vercel/blob";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface Submission {
  blobUrl: string;
  fileName: string;
  submittedAt: string;
  status: SubmissionStatus;
  feedback: string;
}

export interface UserProgress {
  /** Cached Discord username so the admin queue can show who submitted. */
  discordUsername?: string;
  /** Lesson ids whose homework has been approved. */
  completedLessons: string[];
  submissions: {
    [lessonId: string]: Submission;
  };
}

export interface SiteSettings {
  autoApprove: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/** A submission flattened with the user it belongs to — for the admin queue. */
export interface AdminSubmission extends Submission {
  discordId: string;
  discordUsername: string;
  lessonId: string;
}

// ---------------------------------------------------------------------------
// Low-level JSON blob helpers
// ---------------------------------------------------------------------------

function emptyProgress(): UserProgress {
  return { completedLessons: [], submissions: {} };
}

/**
 * Resolve a stable pathname to its current public URL. Because we write with
 * `addRandomSuffix: false`, at most one blob matches the exact pathname.
 */
async function resolveBlobUrl(pathname: string): Promise<string | null> {
  const { blobs } = await list({ prefix: pathname, token: TOKEN });
  const match = blobs.find((b) => b.pathname === pathname);
  return match?.url ?? null;
}

async function readJson<T>(pathname: string, fallback: T): Promise<T> {
  try {
    const url = await resolveBlobUrl(pathname);
    if (!url) return fallback;
    // Cache-bust: stable pathnames keep the same URL across overwrites, and the
    // blob CDN would otherwise serve a stale copy right after a write.
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "public",
    token: TOKEN,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// User progress
// ---------------------------------------------------------------------------

function progressPath(discordId: string): string {
  return `dojo/progress/${discordId}.json`;
}

export async function getUserProgress(
  discordId: string
): Promise<UserProgress> {
  const progress = await readJson<UserProgress>(
    progressPath(discordId),
    emptyProgress()
  );
  // Defensive: guarantee the shape even if an older/partial blob is read back.
  return {
    discordUsername: progress.discordUsername,
    completedLessons: Array.isArray(progress.completedLessons)
      ? progress.completedLessons
      : [],
    submissions:
      progress.submissions && typeof progress.submissions === "object"
        ? progress.submissions
        : {},
  };
}

export async function saveUserProgress(
  discordId: string,
  progress: UserProgress
): Promise<void> {
  await writeJson(progressPath(discordId), progress);
}

/**
 * Every submission across every user, flattened for the admin queue. Scans the
 * `dojo/progress/` prefix and reads each user's progress blob.
 */
export async function getAllSubmissions(): Promise<AdminSubmission[]> {
  const { blobs } = await list({ prefix: "dojo/progress/", token: TOKEN });
  const results: AdminSubmission[] = [];

  for (const blob of blobs) {
    if (!blob.pathname.endsWith(".json")) continue;
    const discordId = blob.pathname
      .replace("dojo/progress/", "")
      .replace(/\.json$/, "");

    try {
      const res = await fetch(`${blob.url}?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const progress = (await res.json()) as UserProgress;
      const submissions = progress.submissions ?? {};

      for (const [lessonId, submission] of Object.entries(submissions)) {
        results.push({
          discordId,
          discordUsername: progress.discordUsername || discordId,
          lessonId,
          ...submission,
        });
      }
    } catch {
      // Skip unreadable/corrupt progress blobs rather than failing the whole list.
    }
  }

  // Newest submissions first.
  results.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return results;
}

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------

const SETTINGS_PATH = "dojo/settings.json";

export async function getSettings(): Promise<SiteSettings> {
  const settings = await readJson<SiteSettings>(SETTINGS_PATH, {
    autoApprove: false,
  });
  return { autoApprove: Boolean(settings.autoApprove) };
}

export async function saveSettings(settings: SiteSettings): Promise<void> {
  await writeJson(SETTINGS_PATH, { autoApprove: Boolean(settings.autoApprove) });
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

const ANNOUNCEMENTS_PATH = "dojo/announcements.json";

export async function getAnnouncements(): Promise<Announcement[]> {
  const list = await readJson<Announcement[]>(ANNOUNCEMENTS_PATH, []);
  return Array.isArray(list) ? list : [];
}

export async function saveAnnouncements(
  announcements: Announcement[]
): Promise<void> {
  await writeJson(ANNOUNCEMENTS_PATH, announcements);
}

// ---------------------------------------------------------------------------
// Homework upload
// ---------------------------------------------------------------------------

/** Upload a homework PDF and return its public blob URL. */
export async function uploadHomework(
  discordId: string,
  lessonId: string,
  fileName: string,
  file: File | Blob
): Promise<string> {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pathname = `dojo/homework/${discordId}/${lessonId}/${timestamp}_${safeName}`;

  const { url } = await put(pathname, file, {
    access: "public",
    token: TOKEN,
    contentType: "application/pdf",
    addRandomSuffix: false,
  });

  return url;
}
