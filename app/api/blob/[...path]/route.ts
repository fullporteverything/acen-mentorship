import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { get } from "@vercel/blob";
import { requireMemberOrResponse } from "@/lib/authz";
import { contentDisposition } from "@/lib/upload-validation";
import { isUploadAvailable } from "@/lib/upload-tracking";

export const dynamic = "force-dynamic";

const STORE_ID = process.env.BLOB_READ_WRITE_TOKEN_STORE_ID;

/**
 * Authenticated proxy for PRIVATE blob files (journal images, homework PDFs).
 *
 * Private blobs aren't publicly fetchable by URL, so anything shown in an
 * <img>/<a> is served through here. Access control:
 *   - must be signed in
 *   - path must be `dojo/{area}/{ownerDiscordId}/...`
 *   - only that owner, or the admin, may read it
 *
 * Example: <img src="/api/blob/dojo/journal/123/entry/456_chart.png" />
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const identity = await requireMemberOrResponse();
  if (identity instanceof Response) return identity;

  const rawDisposition = req.nextUrl.searchParams.get("disposition") || "attachment";
  if (rawDisposition !== "inline" && rawDisposition !== "attachment") {
    return new NextResponse("Invalid disposition", { status: 400 });
  }

  const pathname = ((await params).path || []).join("/");
  const segs = pathname.split("/");
  // Expect dojo/{area}/{ownerId}/...
  if (segs[0] !== "dojo" || segs.length < 4) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ownerId = segs[2];
  if (!identity.isAdmin && !identity.ownerIds.includes(ownerId)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if ((segs[1] === "homework" || segs[1] === "journal") && !(await isUploadAvailable(pathname, identity.isAdmin ? undefined : identity.ownerIds))) {
    return new NextResponse("Upload is quarantined", { status: 423 });
  }

  try {
    const result = await get(pathname, {
      access: "private",
      storeId: STORE_ID,
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return new NextResponse("Not found", { status: 404 });
    }
    const contentType = result.blob.contentType || "application/octet-stream";
    if (rawDisposition === "inline" && contentType !== "application/pdf") {
      return new NextResponse("Preview unavailable", { status: 415 });
    }
    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": contentDisposition(segs.at(-1) || "download", rawDisposition),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
