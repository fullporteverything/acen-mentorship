import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import {
  getAddedLessons,
  getLessonOverrides,
  saveAddedLessons,
  saveLessonOverrides,
} from "@/lib/lesson-store";
import { LESSONS } from "@/lib/lessons-config";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/lesson — remove a single lesson. Admin-only. Body: { id }.
 *
 * Two shapes of "delete", because the two kinds of lesson are stored
 * differently:
 *
 *   - BUILT-IN (static) lessons live in code (`lib/lessons-config.ts`) and
 *     can't be removed from a blob, so deleting one means HIDING it: we write
 *     `hidden: true` into its override and `buildEffectiveLessons` filters it
 *     out of every student/admin surface. The id survives, so the progress and
 *     homework attached to it stay attached — clearing the flag restores the
 *     lesson intact.
 *   - ADMIN-ADDED lessons are genuinely deleted: dropped from the added list,
 *     plus a best-effort strip of any content override stored for that id so a
 *     future lesson reusing the id (unlikely, ids are timestamp-derived)
 *     doesn't inherit ghost overrides.
 */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdminOrResponse();
  if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.lesson.delete", req);
  if (denied) return denied;

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = (body.id || "").trim();
  if (!id) {
    return NextResponse.json(
      { error: "The lesson id to delete is required." },
      { status: 400 }
    );
  }

  // Built-in lesson: hide it instead of deleting (see the note above).
  if (LESSONS.some((l) => l.id === id)) {
    const overrides = await getLessonOverrides();
    await saveLessonOverrides({
      ...overrides,
      [id]: { ...overrides[id], hidden: true },
    });
    return NextResponse.json({ ok: true, hidden: true });
  }

  const added = await getAddedLessons();
  const remaining = added.filter((l) => l.id !== id);
  if (remaining.length === added.length) {
    return NextResponse.json(
      { error: "That lesson no longer exists." },
      { status: 404 }
    );
  }
  await saveAddedLessons(remaining);

  // Best-effort cleanup of any override left behind for this id.
  try {
    const overrides = await getLessonOverrides();
    if (overrides && overrides[id]) {
      const { [id]: _drop, ...rest } = overrides;
      void _drop;
      await saveLessonOverrides(rest);
    }
  } catch {
    // Overrides cleanup is a nicety — never block the delete on it.
  }

  return NextResponse.json({ ok: true });
}
