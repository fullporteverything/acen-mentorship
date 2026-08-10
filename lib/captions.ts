export function hasEnglishSubtitle(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  const subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
  return subtitles.some((item) => {
    if (!item || typeof item !== "object") return false;
    const subtitle = item as Record<string, unknown>;
    const language = String(
      subtitle.language || subtitle.lang || subtitle.code || ""
    ).toLowerCase();
    return language === "en" || language === "eng" || language === "english";
  });
}
