/**
 * Blob-backed persistence for per-user DOJO profile effects.
 *
 * Backed by a **private, OIDC-authenticated** Vercel Blob store: we pass
 * `storeId` (from BLOB_READ_WRITE_TOKEN_STORE_ID) and the runtime's
 * VERCEL_OIDC_TOKEN handles auth — there is no static read-write token. Writes
 * use `access: "private"`; reads go through the authenticated `get()` (private
 * blobs are NOT publicly fetchable by URL).
 *
 * Each member's profile lives at `dojo/profile/{discordId}.json`.
 */

import { get, put } from "@vercel/blob";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;

/** The cosmetic profile effects a member can pick for their calling card. */
export const PROFILE_EFFECTS = ["none", "sakura", "ember", "phi"] as const;
export type ProfileEffect = (typeof PROFILE_EFFECTS)[number];

export interface Profile {
  effect: ProfileEffect;
}

const DEFAULT_PROFILE: Profile = { effect: "none" };

function profilePath(discordId: string): string {
  return `dojo/profile/${discordId}.json`;
}

function isProfileEffect(value: unknown): value is ProfileEffect {
  return (
    typeof value === "string" &&
    (PROFILE_EFFECTS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Low-level private-blob JSON helpers (OIDC via storeId)
// ---------------------------------------------------------------------------

async function readJson<T>(pathname: string, fallback: T): Promise<T> {
  try {
    const result = await get(pathname, {
      access: "private",
      storeId: STORE_ID,
      useCache: false, // stable pathnames are overwritten in place — read origin
    });
    if (!result || result.statusCode !== 200 || !result.stream) return fallback;
    const text = await new Response(result.stream).text();
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(pathname: string, data: unknown): Promise<void> {
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "private",
    storeId: STORE_ID,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

/** Defensive parse of a raw profile blob into a well-shaped profile. */
function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PROFILE };
  const effect = (raw as { effect?: unknown }).effect;
  return { effect: isProfileEffect(effect) ? effect : "none" };
}

export async function getProfile(discordId: string): Promise<Profile> {
  const raw = await readJson<unknown>(profilePath(discordId), null);
  return normalizeProfile(raw);
}

export async function saveProfile(
  discordId: string,
  profile: Profile
): Promise<void> {
  await writeJson(profilePath(discordId), {
    effect: isProfileEffect(profile.effect) ? profile.effect : "none",
  });
}
