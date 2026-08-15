const FALLBACK_SUPPORT_URL = "/support";

/** Discord hard-caps thread names at 100 characters. */
const MAX_THREAD_NAME = 100;
/** Ticket bodies are a nudge for the admin, not an essay. */
export const MAX_TICKET_BODY = 500;

export function supportUrl(value = process.env.NEXT_PUBLIC_SUPPORT_URL): string {
  const candidate = value?.trim();
  if (!candidate) return FALLBACK_SUPPORT_URL;
  if (/^\/(?!\/)[^\\]*$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : FALLBACK_SUPPORT_URL;
  } catch {
    return FALLBACK_SUPPORT_URL;
  }
}

/**
 * Member-supplied ticket text, made safe to hand to Discord: control
 * characters stripped, blank runs collapsed, length capped, and every
 * mass-mention defused. The request also posts with `allowed_mentions` locked
 * down — this is the belt to that's braces, so the text can't read as a ping
 * even if it gets quoted somewhere else later.
 */
export function sanitizeTicketBody(input: unknown): string {
  if (typeof input !== "string") return "";
  return (
    input
      .replace(/\r\n?/g, "\n")
      // Control characters, keeping the newlines we just normalized.
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      // Zero-width space after the @ — reads identically, pings nobody.
      .replace(/@(everyone|here)/gi, "@\u200b$1")
      .trim()
      .slice(0, MAX_TICKET_BODY)
  );
}

/**
 * `ticket-<username>-<shortid>`, reduced to the lowercase slug characters
 * Discord displays cleanly. An all-symbol username collapses to "member" so
 * the thread still gets a usable name.
 */
export function ticketThreadName(
  username: string | null | undefined,
  shortId: string
): string {
  const slug =
    (username ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "member";
  return `ticket-${slug}-${shortId}`.slice(0, MAX_THREAD_NAME);
}
