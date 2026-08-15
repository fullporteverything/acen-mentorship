import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { listHomeworkArchive, type HomeworkArchiveStatus } from "@/lib/homework-archive";
import { progressViewerIds } from "@/lib/progress-link";

export const dynamic = "force-dynamic";

const STATUSES = new Set<HomeworkArchiveStatus>(["pending", "approved", "rejected", "revision_requested"]);

function validCursor(cursor: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { id?: unknown; submittedAt?: unknown };
    return typeof parsed.id === "string" && typeof parsed.submittedAt === "string" && !Number.isNaN(Date.parse(parsed.submittedAt));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;
  const params = new URL(request.url).searchParams;
  const rawStatus = params.get("status") || undefined;
  const cursor = params.get("cursor") || undefined;
  if (rawStatus && !STATUSES.has(rawStatus as HomeworkArchiveStatus)) {
    return NextResponse.json({ error: "Invalid homework status" }, { status: 400 });
  }
  if (cursor && !validCursor(cursor)) {
    return NextResponse.json({ error: "Invalid archive cursor" }, { status: 400 });
  }
  const rawLimit = Number(params.get("limit") || 25);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 100)) : 25;
  try {
    const page = await listHomeworkArchive({
      discordIds: [...new Set(progressViewerIds(identity.discordId))],
      limit,
      lessonId: params.get("lessonId")?.trim() || undefined,
      status: rawStatus as HomeworkArchiveStatus | undefined,
      cursor,
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "Homework archive is temporarily unavailable" }, { status: 503 });
  }
}
