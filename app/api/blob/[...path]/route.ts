import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { get } from "@vercel/blob";
import { auth } from "@/auth";

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
  { params }: { params: { path: string[] } }
) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const pathname = (params.path || []).join("/");
  const segs = pathname.split("/");
  // Expect dojo/{area}/{ownerId}/...
  if (segs[0] !== "dojo" || segs.length < 4) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ownerId = segs[2];
  const uid = session.user.discordId || session.user.id;
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session.user.discordId === process.env.ADMIN_DISCORD_ID;
  if (!isAdmin && ownerId !== uid) {
    return new NextResponse("Forbidden", { status: 403 });
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
    return new NextResponse(result.stream, {
      status: 200,
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
