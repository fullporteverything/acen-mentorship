import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { getSettings, saveSettings } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";


/** GET: current site settings. Admin-only. */
export async function GET() {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  return NextResponse.json(await getSettings());
}

/** POST: update site settings. Admin-only. */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.settings", req); if (denied) return denied;

  let body: { autoApprove?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const settings = { autoApprove: Boolean(body.autoApprove) };
  await saveSettings(settings);

  return NextResponse.json({ ok: true, ...settings });
}
