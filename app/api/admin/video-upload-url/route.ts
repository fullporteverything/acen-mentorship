import { NextResponse } from "next/server";
import { requireAdminOrResponse } from "@/lib/authz";
import { allowMutation } from "@/lib/mutation-security";
import {
  getKinescopeConfig,
  KinescopeIntegrationError,
  KinescopeProjectResolutionError,
  resolveKinescopeProjectId,
} from "@/lib/kinescope";
import { isKinescopeVideoId } from "@/lib/video-id";

export const dynamic = "force-dynamic";

const KINESCOPE_UPLOAD_INIT_URL = "https://uploader.kinescope.io/v2/init";
const MAX_FILE_SIZE = 30 * 1024 * 1024 * 1024;


export async function POST(request: Request) {
  const admin = await requireAdminOrResponse(); if (admin instanceof Response) return admin;
  const denied = await allowMutation(admin, "admin.video.upload_url", request); if (denied) return denied;

  const body = await request.json().catch(() => null);
  const fileName = typeof body?.fileName === "string" ? body.fileName.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const fileSize = body?.fileSize;

  if (!fileName || fileName.length > 512) {
    return NextResponse.json(
      { error: "A valid fileName is required." },
      { status: 400 }
    );
  }
  if (
    typeof fileSize !== "number" ||
    !Number.isInteger(fileSize) ||
    fileSize <= 0 ||
    fileSize > MAX_FILE_SIZE
  ) {
    return NextResponse.json(
      { error: "A valid fileSize is required." },
      { status: 400 }
    );
  }
  if (title.length > 255) {
    return NextResponse.json(
      { error: "Title must be 255 characters or fewer." },
      { status: 400 }
    );
  }

  try {
    const { apiToken } = getKinescopeConfig();
    const projectId = await resolveKinescopeProjectId();
    const response = await fetch(KINESCOPE_UPLOAD_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent_id: projectId,
        type: "video",
        filename: fileName,
        title: title || fileName,
        filesize: fileSize,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        { error: "Kinescope could not initialize the upload." },
        { status: 502 }
      );
    }

    const endpoint = data?.data?.endpoint;
    const videoId = data?.data?.id;
    if (!isKinescopeUploadEndpoint(endpoint) || !isKinescopeVideoId(videoId)) {
      return NextResponse.json(
        { error: "Kinescope returned an invalid upload URL." },
        { status: 502 }
      );
    }

    return NextResponse.json({ uploadUrl: endpoint, videoId });
  } catch (error) {
    const actionableError =
      error instanceof KinescopeProjectResolutionError
        ? error.message
        : error instanceof KinescopeIntegrationError &&
            error.message === "Kinescope is not configured."
          ? "Kinescope is not configured."
          : null;
    const status = actionableError ? 500 : 502;
    return NextResponse.json(
      {
        error:
          actionableError ?? "Failed to reach Kinescope.",
      },
      { status }
    );
  }
}

function isKinescopeUploadEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "kinescope.io" || url.hostname.endsWith(".kinescope.io")) &&
      url.pathname.startsWith("/v2/upload/")
    );
  } catch {
    return false;
  }
}
