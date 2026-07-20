import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  getAllSubmissions,
  getUserProgress,
  saveUserProgress,
} from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session?.user?.discordId === process.env.ADMIN_DISCORD_ID;
  return isAdmin;
}

/** GET: every submission across all users, for the admin review queue. */
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const submissions = await getAllSubmissions();
  return NextResponse.json({ submissions });
}

/** POST: approve or reject a specific user's submission. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    discordId?: string;
    lessonId?: string;
    action?: "approve" | "reject";
    feedback?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { discordId, lessonId, action } = body;
  const feedback = typeof body.feedback === "string" ? body.feedback : "";

  if (typeof discordId !== "string" || !discordId) {
    return NextResponse.json(
      { error: "discordId must be a non-empty string" },
      { status: 400 }
    );
  }

  if (
    !discordId ||
    !lessonId ||
    (action !== "approve" && action !== "reject")
  ) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const progress = await getUserProgress(discordId);
  const submission = progress.submissions[lessonId];

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  submission.status = action === "approve" ? "approved" : "rejected";
  submission.feedback = feedback;

  if (action === "approve") {
    if (!progress.completedLessons.includes(lessonId)) {
      progress.completedLessons.push(lessonId);
    }
  } else {
    progress.completedLessons = progress.completedLessons.filter(
      (id) => id !== lessonId
    );
  }

  await saveUserProgress(discordId, progress);

  return NextResponse.json({ ok: true, status: submission.status });
}
