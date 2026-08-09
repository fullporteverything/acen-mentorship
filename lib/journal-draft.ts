export type JournalDraftTag = "Funded" | "Eval" | null;

export function parseJournalDraft(raw: string | null): {
  body: string;
  tag: JournalDraftTag;
} {
  if (!raw) return { body: "", tag: null };
  try {
    const parsed = JSON.parse(raw) as { body?: unknown; tag?: unknown };
    const body = typeof parsed.body === "string" ? parsed.body.slice(0, 5000) : "";
    const tag = parsed.tag === "Funded" || parsed.tag === "Eval" ? parsed.tag : null;
    return { body, tag };
  } catch {
    return { body: "", tag: null };
  }
}
