import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { backfillLegacyArchive } from "@/lib/homework-archive";

export const dynamic = "force-dynamic";

/** POST: import legacy Blob-only homework into the Neon archive. Admin-only, idempotent. */
export async function POST(req: NextRequest) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.backfill-archive", req); if (denied) return denied;

  const result = await backfillLegacyArchive();
  return NextResponse.json({ ok: true, ...result });
}
