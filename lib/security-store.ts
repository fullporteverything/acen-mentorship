import "server-only";

import { get, list, put } from "@vercel/blob";
import {
  applyCaptureAttempt,
  normalizeSecurityMember,
  type CaptureLog,
  type SecurityMember,
} from "./security-model";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;
const PREFIX = "dojo/security/members/";

function safeDiscordId(discordId: string): string {
  return discordId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "unknown";
}

function memberPath(discordId: string): string {
  return `${PREFIX}${safeDiscordId(discordId)}.json`;
}

async function readMember(
  discordId: string,
  discordUsername = "Discord member"
): Promise<SecurityMember> {
  try {
    const result = await get(memberPath(discordId), {
      access: "private",
      storeId: STORE_ID,
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return normalizeSecurityMember(null, discordId, discordUsername);
    }
    const raw = JSON.parse(await new Response(result.stream).text());
    return normalizeSecurityMember(raw, discordId, discordUsername);
  } catch {
    return normalizeSecurityMember(null, discordId, discordUsername);
  }
}

async function writeMember(member: SecurityMember): Promise<void> {
  await put(memberPath(member.discordId), JSON.stringify(member, null, 2), {
    access: "private",
    storeId: STORE_ID,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export function getSecurityMember(discordId: string, username?: string) {
  return readMember(discordId, username);
}

export async function recordCaptureAttempt(
  discordId: string,
  discordUsername: string,
  attempt: CaptureLog
): Promise<SecurityMember> {
  const current = await readMember(discordId, discordUsername);
  const next = applyCaptureAttempt(current, attempt, discordUsername);
  await writeMember(next);
  return next;
}

export async function acknowledgeStrike(discordId: string): Promise<SecurityMember> {
  const member = await readMember(discordId);
  const next = { ...member, acknowledgedStrikes: member.strikes };
  await writeMember(next);
  return next;
}

export async function resetSecurityMember(discordId: string): Promise<SecurityMember> {
  const member = await readMember(discordId);
  const next = {
    ...member,
    strikes: 0,
    acknowledgedStrikes: 0,
    locked: false,
    updatedAt: new Date().toISOString(),
  };
  await writeMember(next);
  return next;
}

export async function getSecurityMembers(): Promise<SecurityMember[]> {
  const { blobs } = await list({ prefix: PREFIX, storeId: STORE_ID });
  const ids = blobs.map((blob) =>
    blob.pathname.slice(PREFIX.length).replace(/\.json$/, "")
  );
  const members = await Promise.all(ids.map((id) => readMember(id)));
  return members
    .filter((member) => member.strikes > 0)
    .sort((a, b) => b.strikes - a.strikes || b.updatedAt.localeCompare(a.updatedAt));
}
