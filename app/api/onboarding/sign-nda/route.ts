import { NextResponse } from "next/server";

import { requireMemberOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import { consumeRateLimit } from "@/lib/rate-limit";
import { NDA_HASH, NDA_VERSION } from "@/lib/nda";
import { recordNdaSignature } from "@/lib/onboarding-store";

export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/sign-nda
 * Body: { legalName: string, consentEsign: boolean, consentAgree: boolean }
 * Records an immutable NDA signature for the current member against the live
 * NDA_VERSION / NDA_HASH.
 */
export async function POST(req: Request) {
  const member = await requireMemberOrResponse();
  if (member instanceof Response) return member;
  const denied = await allowMutation(member, "onboarding.sign-nda", req);
  if (denied) return denied;
  const rate = await consumeRateLimit(member.discordId, "onboarding.sign-nda", {
    limit: 10,
    windowMs: 3_600_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  const record = (body ?? {}) as {
    legalName?: unknown;
    consentEsign?: unknown;
    consentAgree?: unknown;
  };

  const legalName = typeof record.legalName === "string" ? record.legalName.trim() : "";
  if (legalName.length < 2 || legalName.length > 120) {
    return NextResponse.json({ ok: false, error: "Enter your full legal name" }, { status: 400 });
  }
  if (record.consentEsign !== true || record.consentAgree !== true) {
    return NextResponse.json({ ok: false, error: "Both consents are required" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  await recordNdaSignature({
    discordId: member.discordId,
    displayName: member.name,
    legalName,
    ndaVersion: NDA_VERSION,
    ndaHash: NDA_HASH,
    ip,
    userAgent,
  });

  return NextResponse.json({ ok: true });
}
