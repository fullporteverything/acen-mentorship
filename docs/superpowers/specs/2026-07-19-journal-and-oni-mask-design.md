# Journal page + animated Oni mask — Design

Date: 2026-07-19
Project: `acen-mentorship` (DOJO — private Discord-gated mentorship platform, Next.js 14 App Router, NextAuth v5, Vercel Blob)

## Goal

Replace the dead **Resources** sidebar link with a **Journal** page where members post
their trades (text + images) and their mentor gives targeted feedback on specific
entries. Replace the "Dojo / Mentorship" text logo in the sidebar with an animated
oni mask.

## Decisions (locked)

- **Look:** the layout/structure of the APOSTLES reference (centered column, "My Journal"
  heading, "private journal between you and your mentor" subtitle, composer, entry cards),
  but rendered in the existing **dojo palette** (dark cards, `#E8A0A0` pink-red, Georgia
  serif) for consistency with Lessons/Overview — not the APOSTLES dark+gold aesthetic.
- **Sizing:** more compact than the reference. Centered column ~560px; heading ~18px;
  body ~13px; timestamps ~10px; card padding ~20px; gaps ~16px.
- **Background:** plain/solid dojo background — **no** floating-glyph / particle background
  behind the content (the reference's scattered letters and the site's `ThreeBackground`
  are deliberately excluded; `ThreeBackground` stays on the login page only).
- **Oni mask:** stylized **SVG with CSS-only animation** (subtle 3D tilt + float + glow),
  no WebGL, no model file. Replaces the sidebar logo text block; a small "DOJO" caption
  stays beneath it for identity.
- **Text limit:** **500 words** per entry (honoring the instruction over the screenshot's
  5000-char counter), enforced client- and server-side.
- **Images:** up to **4** trade images per entry, `image/png|jpeg|webp|gif`, ≤10 MB each.
- **Mentor access:** mentor/admin can view **all** members' journals and leave
  **per-entry feedback**; the member sees that feedback attached to the specific entry.
- **Persistence:** reuse the existing Vercel Blob convention from `lib/lesson-store.ts`
  (JSON blobs under the `dojo/` prefix + uploaded files). No new database or storage.

### Scoped out of v1 (conscious YAGNI)

- "Day streak" badge from the reference.
- Editing / deleting past entries.
- Threaded back-and-forth (mentor feedback is a single, editable note per entry).

## Data model — `lib/journal-store.ts`

Mirrors `lib/lesson-store.ts` (same `readJson`/`writeJson`/`put`/`list` helpers, same
`dojo/` prefix, `addRandomSuffix: false`, cache-busted reads).

```ts
interface JournalEntry {
  id: string;            // timestamp-based unique id
  body: string;          // <= 500 words
  images: string[];      // public blob URLs
  createdAt: string;     // ISO
  feedback?: string;     // mentor note on THIS entry
  feedbackAt?: string;   // ISO, when feedback was last saved
}

interface UserJournal {
  discordUsername?: string;
  entries: JournalEntry[];   // newest first
}

interface AdminJournalEntry extends JournalEntry {
  discordId: string;
  discordUsername: string;
}
```

Blob layout:
- `dojo/journal/{discordId}.json` — the user's `UserJournal`.
- `dojo/journal/{discordId}/{timestamp}_{safeName}` — uploaded trade images.

Functions:
- `getUserJournal(discordId): Promise<UserJournal>` — defensive shape, empty default.
- `saveUserJournal(discordId, journal): Promise<void>`.
- `uploadJournalImage(discordId, fileName, file): Promise<string>` — returns blob URL.
- `getAllJournals(): Promise<AdminJournalEntry[]>` — scans `dojo/journal/` prefix, flattens
  every entry across users, newest first (same pattern as `getAllSubmissions`).
- `setEntryFeedback(discordId, entryId, feedback): Promise<boolean>` — loads that user's
  journal, sets `feedback`/`feedbackAt` on the matching entry, saves; false if not found.

## Components & routes

### `app/dashboard/journal/page.tsx` (server component)
- Auth-gate (redirect `/` if no session), read own `getUserJournal(discordId)`.
- Renders: Sidebar (`active="/dashboard/journal"`), compact centered column with the
  heading/subtitle, `<JournalComposer />`, then entry cards newest-first. Each card:
  timestamp, body, thumbnail grid of images (click opens full blob URL in new tab), and —
  when present — a distinct **"Mentor feedback"** block (gold/red accent) beneath the entry.

### `components/JournalComposer.tsx` (client)
- Textarea + live **word counter** (`X / 500 words`); Post disabled when over 500 or empty.
- Image picker: up to 4 files, type/size validated, thumbnail previews with remove buttons.
- Submits multipart `FormData` to `POST /api/journal/post`, then `router.refresh()`.
- Mirrors `HomeworkUpload.tsx` structure and error handling.

### `app/api/journal/post/route.ts` (`force-dynamic`)
- Auth-gate → parse `FormData` (`body` + `image` files).
- Validate: body non-empty and ≤500 words; ≤4 images; each an accepted image type ≤10 MB.
- Upload images → build `JournalEntry` → prepend to `entries` → save. Returns `{ ok: true }`.

### Mentor view — admin panel "Journals" section
- Add a section listing `getAllJournals()` results: each entry shows member, timestamp,
  body, images, and a small feedback textarea + Save.
- Save posts to **`app/api/admin/journal-feedback/route.ts`** (admin-gated, POST
  `{ discordId, entryId, feedback }`) → `setEntryFeedback(...)`.
- Wiring (client feedback box vs. server render) follows however the existing admin
  homework queue is built; to be finalized in the plan after reading `AdminPanel.tsx`.

### `components/OniMask.tsx`
- Stylized oni mask in SVG (horns, angry brow, fangs) using the site red; CSS keyframes for
  a slow float + slight 3D tilt (`transform: rotate3d`) + a soft red glow. Pure CSS/SVG so it
  can render inside the server-component Sidebar. Small "DOJO" caption beneath.

### `components/Sidebar.tsx` (edit)
- Replace the "Dojo / Mentorship" text block with `<OniMask />`.
- Change the `NAV_LINKS` "Resources" entry to `{ label: "Journal", href: "/dashboard/journal" }`.

## Validation / edge cases

- Word count: `body.trim().split(/\s+/).filter(Boolean).length` on both client and server.
- Corrupt/partial journal blobs: defensive defaults (like `getUserProgress`).
- No images + text-only entry: allowed. Empty entry (no text, no images): rejected.
- Feedback save when entry id not found: 404, no-op.

## Out-of-scope confirmation

No changes to auth, middleware, the security guards, or the lessons system beyond adding
the `getAllJournals`/feedback wiring into the existing admin panel.
