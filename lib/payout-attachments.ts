/**
 * Which Discord attachment, if any, is worth sending to be read — and when none
 * is, why not.
 *
 * Kept out of payout-vision because that module is server-only (it holds the
 * API client) and this is pure decision logic the test suite has to import.
 * Same split as payout-ingest against payout-store.
 */

/** Anthropic accepts these; anything else is skipped rather than guessed at. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** Comfortably under the API's per-image ceiling, and a sane download cap. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;


const EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function typeFromName(url: string): string | null {
  const path = url.split("?")[0] ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[ext] ?? null;
}

/** Picks the one attachment worth reading, or null if there isn't one. */
export function firstReadableImage(
  attachments:
    | { url: string; filename?: string; content_type?: string; size?: number }[]
    | undefined
): { url: string; mediaType: string } | null {
  for (const attachment of attachments ?? []) {
    const declared = attachment.content_type?.split(";")[0]?.trim().toLowerCase();
    // Fall back to the extension: content_type is usually present but is not
    // guaranteed, and skipping a real screenshot over a missing header would
    // be an invisible failure.
    const type = declared && IMAGE_TYPES.has(declared) ? declared : typeFromName(attachment.url);
    if (!type) continue;
    if ((attachment.size ?? 0) > MAX_IMAGE_BYTES) continue;
    return { url: attachment.url, mediaType: type };
  }
  return null;
}

/**
 * Why nothing on this message could be read — for the review post.
 *
 * "No readable image" is true but useless: it leaves the owner unable to tell a
 * video from an oversized file from a message that never had an attachment. A
 * screen recording of a payout is a perfectly reasonable thing for a member to
 * post, and the right answer to it is "type the number", not silence.
 */
export function unreadableReason(
  attachments:
    | { url: string; filename?: string; content_type?: string; size?: number }[]
    | undefined
): string {
  const list = attachments ?? [];
  if (list.length === 0) return "no attachment on the message";

  if (list.some((a) => a.content_type?.split("/")[0]?.toLowerCase() === "video")) {
    return "video attached — video can't be read automatically, reply with the amount";
  }
  if (list.some((a) => (a.size ?? 0) > MAX_IMAGE_BYTES)) {
    return "image is too large to read automatically, reply with the amount";
  }
  const types = list.map((a) => a.content_type ?? "unknown type").join(", ");
  return `attachment can't be read automatically (${types}), reply with the amount`;
}
