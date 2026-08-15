import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import {
  getAddedLessons,
  getAddedSections,
  getLessonOverrides,
  saveAddedLessons,
  saveAddedSections,
  saveLessonOverrides,
} from "@/lib/lesson-store";
import { LESSONS, normalizeGroupName } from "@/lib/lessons-config";

export const dynamic = "force-dynamic";


/** True when the static curriculum contributes any lesson to `section`. */
function hasStaticLessons(section: string): boolean {
  return LESSONS.some((l) => l.group === section);
}

/** Section membership, casing/spacing insensitive (admins type by hand). */
function inSection(lesson: { group: string }, section: string): boolean {
  return normalizeGroupName(lesson.group) === normalizeGroupName(section);
}

/**
 * PATCH: rename a section. Admin-only. Body: { from, to }.
 *
 * Renames every admin-added lesson whose group is `from` to `to`, and replaces
 * `from` with `to` in the admin-added (empty) sections list. Sections that
 * contain built-in (static) lessons can't be renamed — their group is fixed in
 * `lib/lessons-config.ts` and not stored in a blob — so the request is refused.
 */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.section.patch", req); if (denied) return denied;

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const from = (body.from || "").trim();
  const to = (body.to || "").trim();
  if (!from) {
    return NextResponse.json(
      { error: "The section to rename is required." },
      { status: 400 }
    );
  }
  if (!to) {
    return NextResponse.json(
      { error: "A new section name is required." },
      { status: 400 }
    );
  }
  if (to.length > 255) {
    return NextResponse.json(
      { error: "Section name must be 255 characters or fewer." },
      { status: 400 }
    );
  }

  if (hasStaticLessons(from)) {
    return NextResponse.json(
      { error: "This section contains built-in lessons and can't be renamed." },
      { status: 409 }
    );
  }

  if (from === to) {
    return NextResponse.json({ ok: true, section: to });
  }

  // Rename the group on every admin-added lesson currently in `from`.
  const added = await getAddedLessons();
  let changed = false;
  for (const lesson of added) {
    if (lesson.group === from) {
      lesson.group = to;
      changed = true;
    }
  }
  if (changed) {
    await saveAddedLessons(added);
  }

  // Swap `from` for `to` in the admin-added empty sections list (deduped).
  const sections = await getAddedSections();
  if (sections.includes(from)) {
    const next = sections.filter((s) => s !== from);
    if (!next.includes(to)) {
      next.push(to);
    }
    await saveAddedSections(next);
  }

  return NextResponse.json({ ok: true, section: to });
}

/**
 * DELETE: remove a section. Admin-only. Body: { section, force? }.
 *
 * ANY section can be deleted, including one holding built-in lessons. Empty
 * sections go quietly; a section that still holds visible lessons answers 409
 * with `requiresForce` so the UI can confirm the lesson count first.
 *
 * With `force: true` the section's lessons go away the same way a single
 * lesson delete removes them: admin-added lessons are dropped outright (and
 * their overrides with them), while built-in lessons — which live in code and
 * can't be deleted from a blob — get `hidden: true` written to their override,
 * keeping their progress/homework attached to the id.
 */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.section.delete", req); if (denied) return denied;

  let body: { section?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const section = (body.section || "").trim();
  if (!section) {
    return NextResponse.json(
      { error: "The section to delete is required." },
      { status: 400 }
    );
  }

  const overrides = await getLessonOverrides();
  const added = await getAddedLessons();
  // Already-hidden built-ins don't count: they're gone from every surface, so
  // deleting their section isn't destroying anything the admin can still see.
  const staticVisible = LESSONS.filter(
    (l) => inSection(l, section) && overrides[l.id]?.hidden !== true
  );
  const addedInSection = added.filter((l) => inSection(l, section));
  const lessonCount = staticVisible.length + addedInSection.length;

  // Section still holds lessons — require an explicit force confirmation.
  if (lessonCount > 0 && body.force !== true) {
    return NextResponse.json(
      {
        error: `Section has ${lessonCount} lesson${
          lessonCount === 1 ? "" : "s"
        } — confirm deletion.`,
        requiresForce: true,
        lessonCount,
      },
      { status: 409 }
    );
  }

  // One overrides write covers both halves: hide the built-ins, and drop the
  // now-deleted admin lessons' override entries.
  if (staticVisible.length > 0 || addedInSection.some((l) => overrides[l.id])) {
    const next = { ...overrides };
    for (const lesson of staticVisible) {
      next[lesson.id] = { ...next[lesson.id], hidden: true };
    }
    for (const lesson of addedInSection) {
      delete next[lesson.id];
    }
    await saveLessonOverrides(next);
  }

  if (addedInSection.length > 0) {
    await saveAddedLessons(added.filter((l) => !inSection(l, section)));
  }

  const sections = await getAddedSections();
  if (sections.some((s) => normalizeGroupName(s) === normalizeGroupName(section))) {
    await saveAddedSections(
      sections.filter((s) => normalizeGroupName(s) !== normalizeGroupName(section))
    );
  }

  return NextResponse.json({ ok: true });
}
