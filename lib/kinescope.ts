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
  playLink?: string;
  embedLink?: string;
  error?: string;
}

/** A safe error suitable for handling without exposing provider secrets. */
export class KinescopeIntegrationError extends Error {
  constructor(message = "Kinescope integration failed.") {
    super(message);
    this.name = "KinescopeIntegrationError";
  }
}

/** Safe, actionable project-selection error for authenticated admin routes. */
export class KinescopeProjectResolutionError extends KinescopeIntegrationError {
  constructor(message: string) {
    super(message);
    this.name = "KinescopeProjectResolutionError";
  }
}

export function getKinescopeConfig(): {
  apiToken: string;
  projectId?: string;
  playerId: string;
} {
  const apiToken = process.env.KINESCOPE_API_TOKEN?.trim();
  const projectId = process.env.KINESCOPE_PROJECT_ID?.trim();
  const playerId = process.env.KINESCOPE_PLAYER_ID?.trim();

  if (!apiToken || !playerId) {
    throw new KinescopeIntegrationError("Kinescope is not configured.");
  }

  return {
    apiToken,
    playerId,
    ...(projectId ? { projectId } : {}),
  };
}

export async function resolveKinescopeProjectId(): Promise<string> {
  const configuredProjectId = getKinescopeConfig().projectId;
  if (configuredProjectId) return configuredProjectId;

  const response = await kinescopeFetch(
    "/projects?page=1&per_page=100&order=created_at.desc",
    {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );
  const payload = await response.json().catch(() => null);
  const projects = Array.isArray(payload?.data)
    ? payload.data
        .map((raw: unknown) => safeProject(raw))
        .filter(
          (project: { id: string; name: string } | null): project is {
            id: string;
            name: string;
          } => project !== null
        )
    : [];

  if (projects.length === 1) return projects[0].id;
  if (projects.length === 0) {
    throw new KinescopeProjectResolutionError(
      "No Kinescope projects were found. Create a project or set KINESCOPE_PROJECT_ID."
    );
  }

  // The message on this error is returned to the admin browser, so it must not
  // enumerate the Kinescope account's project names + IDs. Log the detailed list
  // server-side (operator-only) and hand the client a generic instruction.
  console.error(
    `Multiple Kinescope projects found; set KINESCOPE_PROJECT_ID to one of: ${projects
      .map(
        (project: { id: string; name: string }) =>
          `${project.name} (${project.id})`
      )
      .join(", ")}`
  );
  throw new KinescopeProjectResolutionError(
    "Multiple Kinescope projects found — set KINESCOPE_PROJECT_ID."
  );
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

  const playLink = kinescopeLink(video.play_link, false);
  const embedLink =
    kinescopeLink(video.embed_link, true) || embedLinkFromPlayLink(playLink);

  return {
    id,
    title: stringValue(video.title) || id,
    createdAt: stringValue(video.created_at) || stringValue(video.createdAt),
    duration: numberValue(video.duration),
    status,
    progress: numberValue(video.progress),
    ready: status === "done",
    ...(playLink ? { playLink } : {}),
    ...(embedLink ? { embedLink } : {}),
    ...(status === "aborted" || status === "error"
      ? { error: "Video processing failed." }
      : {}),
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

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function kinescopeLink(value: unknown, embed: boolean): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "kinescope.io") return "";
    if (embed && !url.pathname.startsWith("/embed/")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function embedLinkFromPlayLink(playLink: string): string {
  if (!playLink) return "";
  const url = new URL(playLink);
  if (!url.pathname || url.pathname === "/" || url.pathname.startsWith("/embed/")) {
    return "";
  }
  return new URL(`/embed${url.pathname}`, url.origin).toString();
}

function safeProject(raw: unknown): { id: string; name: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const project = raw as Record<string, unknown>;
  const id = typeof project.id === "string" ? project.id.trim() : "";
  if (!id || id.length > 128) return null;
  const rawName = typeof project.name === "string" ? project.name.trim() : "";
  const name = (rawName || "Unnamed project")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 100);
  return { id, name };
}
