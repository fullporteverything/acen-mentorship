import "server-only";

import { isKinescopeVideoId } from "./video-id";

const KINESCOPE_API_URL = "https://api.kinescope.io/v1";
const VIDEO_STATUSES = [
  "pending",
  "uploading",
  "pre-processing",
  "processing",
  "done",
  "aborted",
  "error",
] as const;

type KinescopeVideoStatus = (typeof VIDEO_STATUSES)[number];

export interface LibraryVideo {
  id: string;
  title: string;
  createdAt: string;
  duration: number | null;
  status: KinescopeVideoStatus;
  progress: number | null;
  ready: boolean;
  error?: string;
}

/** A safe error suitable for handling without exposing provider secrets. */
export class KinescopeIntegrationError extends Error {
  constructor(message = "Kinescope integration failed.") {
    super(message);
    this.name = "KinescopeIntegrationError";
  }
}

export function getKinescopeConfig(): {
  apiToken: string;
  projectId: string;
  playerId: string;
} {
  const apiToken = process.env.KINESCOPE_API_TOKEN?.trim();
  const projectId = process.env.KINESCOPE_PROJECT_ID?.trim();
  const playerId = process.env.KINESCOPE_PLAYER_ID?.trim();

  if (!apiToken || !projectId || !playerId) {
    throw new KinescopeIntegrationError("Kinescope is not configured.");
  }

  return { apiToken, projectId, playerId };
}

export function normalizeKinescopeVideo(raw: unknown): LibraryVideo {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new KinescopeIntegrationError("Kinescope returned an invalid video.");
  }

  const video = raw as Record<string, unknown>;
  const id = video.id;
  const status = video.status;
  if (!isKinescopeVideoId(id) || !isKinescopeVideoStatus(status)) {
    throw new KinescopeIntegrationError("Kinescope returned an invalid video.");
  }

  const error = normalizeError(video.error);
  return {
    id,
    title: stringValue(video.title) || id,
    createdAt: stringValue(video.created_at) || stringValue(video.createdAt),
    duration: numberValue(video.duration),
    status,
    progress: numberValue(video.progress),
    ready: status === "done",
    ...(error ? { error } : {}),
  };
}

export async function kinescopeFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const { apiToken } = getKinescopeConfig();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiToken}`);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${KINESCOPE_API_URL}${normalizePath(path)}`, {
      ...init,
      headers,
    });
  } catch {
    throw new KinescopeIntegrationError();
  }

  if (!response.ok) {
    throw new KinescopeIntegrationError();
  }

  return response;
}

function isKinescopeVideoStatus(value: unknown): value is KinescopeVideoStatus {
  return typeof value === "string" && VIDEO_STATUSES.includes(value as KinescopeVideoStatus);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeError(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return stringValue((value as Record<string, unknown>).message);
  }
  return "";
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
