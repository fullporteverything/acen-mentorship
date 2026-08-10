const FALLBACK_SUPPORT_URL = "/support";

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
