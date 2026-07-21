import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  getAddedLessons,
  getAddedSections,
  saveAddedLessons,
  saveAddedSections,
} from "@/lib/lesson-store";
import { LESSONS } from "@/lib/lessons-config";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  return (
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID
  );
}

/** True when the static curriculum contributes any lesson to `section`. */
function hasStaticLessons(section: string): boolean {
  return LESSONS.some((l) => l.group === section);
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
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
 * Empty sections (created by the admin) delete freely. Sections holding only
 * admin-added lessons require `force: true` — those lessons are deleted too.
 * Sections that contain built-in (static) lessons can never be deleted.
 */
export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  if (hasStaticLessons(section)) {
    return NextResponse.json(
      { error: "This section contains built-in lessons and can't be deleted." },
      { status: 409 }
    );
  }

  const added = await getAddedLessons();
  const inSection = added.filter((l) => l.group === section);

  // Section holds admin-added lessons — require an explicit force confirmation.
  if (inSection.length > 0 && !body.force) {
    return NextResponse.json(
      {
        error: `Section has ${inSection.length} lesson${
          inSection.length === 1 ? "" : "s"
        } — confirm deletion.`,
        requiresForce: true,
        lessonCount: inSection.length,
      },
      { status: 409 }
    );
  }

  if (inSection.length > 0) {
    const remaining = added.filter((l) => l.group !== section);
    await saveAddedLessons(remaining);
  }

  const sections = await getAddedSections();
  if (sections.includes(section)) {
    await saveAddedSections(sections.filter((s) => s !== section));
  }

  return NextResponse.json({ ok: true });
}
