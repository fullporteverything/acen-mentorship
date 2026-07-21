import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  getProfile,
  saveProfile,
  PROFILE_EFFECTS,
  type ProfileEffect,
} from "@/lib/profile-store";

export const dynamic = "force-dynamic";

function isProfileEffect(value: unknown): value is ProfileEffect {
  return (
    typeof value === "string" &&
    (PROFILE_EFFECTS as readonly string[]).includes(value)
  );
}

/** GET: the signed-in member's own selected profile effect. */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const discordId = session.user.discordId || session.user.id;
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { effect } = await getProfile(discordId);
  return NextResponse.json({ effect });
}

/** POST: set the signed-in member's own profile effect. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const discordId = session.user.discordId || session.user.id;
  if (!discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { effect?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isProfileEffect(body.effect)) {
    return NextResponse.json({ error: "Invalid effect" }, { status: 400 });
  }

  await saveProfile(discordId, { effect: body.effect });
  return NextResponse.json({ ok: true });
}
