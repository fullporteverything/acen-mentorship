/**
 * Blob-backed persistence for the lessons system.
 *
 * Everything lives under the `dojo/` prefix in a single Vercel Blob store:
 *   - dojo/progress/{discordId}.json  — per-user homework progress
 *   - dojo/settings.json              — site-wide settings (auto-approve)
 *   - dojo/announcements.json         — announcement feed
 *   - dojo/homework/{discordId}/...   — the uploaded homework PDFs
 *
 * Backed by a **private, OIDC-authenticated** Vercel Blob store: we pass
 * `storeId` (from BLOB_READ_WRITE_TOKEN_STORE_ID) and the runtime's
 * VERCEL_OIDC_TOKEN handles auth — there is no static read-write token. Writes
 * use `access: "private"`; reads go through the authenticated `get()` (private
 * blobs are NOT publicly fetchable by URL). Homework PDFs are shown via the
 * /api/blob proxy, which enforces owner/admin access.
 */

import { get, list, put } from "@vercel/blob";
import type { Lesson, LessonOverrides } from "./lessons-config";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface Submission {
  /**
   * Blob PATHNAME of the homework PDF, shown via the /api/blob proxy.
   * (Legacy rows may hold a full public URL — display code handles both.)
   */
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
  const { blobs } = await list({ prefix: "dojo/progress/", storeId: STORE_ID });
  const results: AdminSubmission[] = [];

  for (const blob of blobs) {
    if (!blob.pathname.endsWith(".json")) continue;
    const discordId = blob.pathname
      .replace("dojo/progress/", "")
      .replace(/\.json$/, "");

    try {
      const result = await get(blob.pathname, {
        access: "private",
        storeId: STORE_ID,
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) continue;
      const text = await new Response(result.stream).text();
      if (!text) continue;
      const progress = JSON.parse(text) as UserProgress;
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
// Lesson content overrides (inline editing) + admin-added lessons
//
// The static curriculum in `lib/lessons-config.ts` is the base. These two
// blobs layer on top so admins can edit copy and append lessons at runtime:
//   - dojo/lesson-overrides.json  — { [lessonId]: { title?, description?, homeworkPrompt? } }
//   - dojo/added-lessons.json     — Lesson[] appended after the static list
// ---------------------------------------------------------------------------

const LESSON_OVERRIDES_PATH = "dojo/lesson-overrides.json";
const ADDED_LESSONS_PATH = "dojo/added-lessons.json";
const ADDED_SECTIONS_PATH = "dojo/added-sections.json";

/** Admin content overrides keyed by lessonId. Empty object if none/unreadable. */
export async function getLessonOverrides(): Promise<LessonOverrides> {
  const overrides = await readJson<LessonOverrides>(LESSON_OVERRIDES_PATH, {});
  return overrides && typeof overrides === "object" ? overrides : {};
}

export async function saveLessonOverrides(
  overrides: LessonOverrides
): Promise<void> {
  await writeJson(LESSON_OVERRIDES_PATH, overrides);
}

/** Admin-added lessons appended after the static curriculum. */
export async function getAddedLessons(): Promise<Lesson[]> {
  const lessons = await readJson<Lesson[]>(ADDED_LESSONS_PATH, []);
  return Array.isArray(lessons) ? lessons : [];
}

export async function saveAddedLessons(lessons: Lesson[]): Promise<void> {
  await writeJson(ADDED_LESSONS_PATH, lessons);
}

/**
 * Admin-added empty sections — section names created without a first lesson.
 * These render as section headers (with an admin "add lesson" control) even
 * before any lesson lives in them.
 */
export async function getAddedSections(): Promise<string[]> {
  const sections = await readJson<string[]>(ADDED_SECTIONS_PATH, []);
  return Array.isArray(sections)
    ? sections.filter((s) => typeof s === "string")
    : [];
}

export async function saveAddedSections(sections: string[]): Promise<void> {
  await writeJson(ADDED_SECTIONS_PATH, sections);
}

// ---------------------------------------------------------------------------
// Announcements — per-user "seen" tracking
//
// A user's list of announcement IDs they've already viewed. Anything in the
// current announcements feed not in this list is "unread" on their Overview.
// ---------------------------------------------------------------------------

function seenPath(discordId: string): string {
  return `dojo/announcements-seen/${discordId}.json`;
}

export async function getSeenAnnouncements(
  discordId: string
): Promise<string[]> {
  const raw = await readJson<string[]>(seenPath(discordId), []);
  return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
}

export async function markAnnouncementSeen(
  discordId: string,
  id: string
): Promise<void> {
  if (!id) return;
  const current = await getSeenAnnouncements(discordId);
  if (current.includes(id)) return;
  await writeJson(seenPath(discordId), [...current, id]);
}

// ---------------------------------------------------------------------------
// Homework upload
// ---------------------------------------------------------------------------

/**
 * Upload a homework PDF (stored PRIVATE under the member's own prefix) and
 * return the pathname to persist on the submission. The PDF is shown via the
 * /api/blob proxy, which enforces owner/admin access.
 */
export async function uploadHomework(
  discordId: string,
  lessonId: string,
  fileName: string,
  file: File | Blob
): Promise<string> {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pathname = `dojo/homework/${discordId}/${lessonId}/${timestamp}_${safeName}`;

  await put(pathname, file, {
    access: "private",
    storeId: STORE_ID,
    contentType: "application/pdf",
    addRandomSuffix: false,
  });

  return pathname;
}
