import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomeworkArchive from "@/components/HomeworkArchive";
import type { HomeworkArchiveItem } from "@/lib/homework-archive";

const make = (id: string, lessonId: string, lessonTitle: string, version: number): HomeworkArchiveItem => ({
  id, lessonId, lessonTitle, version, fileName: `${id}.pdf`, submittedAt: `2026-08-${String(version).padStart(2, "0")}T12:00:00.000Z`,
  status: version === 1 ? "approved" : "pending", feedback: version === 1 ? "Nice work" : "", available: true,
  previewUrl: `/preview/${id}`, downloadUrl: `/download/${id}`,
});

describe("HomeworkArchive", () => {
  it("groups immutable versions by lesson and exposes feedback and file actions", () => {
    const html = renderToStaticMarkup(<HomeworkArchive items={[make("a2", "a", "Alpha", 2), make("b1", "b", "Beta", 1), make("a1", "a", "Alpha", 1)]} nextCursor={null} />);
    expect((html.match(/<h2/g) ?? [])).toHaveLength(2);
    expect(html).toContain("Alpha");
    expect(html).toContain("Version 2");
    expect(html).toContain("Nice work");
    expect(html).toContain("Preview");
    expect(html).toContain("Download");
  });

  it("shows an empty state and a load-more link when present", () => {
    expect(renderToStaticMarkup(<HomeworkArchive items={[]} nextCursor={null} />)).toContain("No homework matches");
    const html = renderToStaticMarkup(<HomeworkArchive items={[make("a", "a", "Alpha", 1)]} nextCursor="cursor-value" />);
    expect(html).toContain("Load more");
    expect(html).toContain("cursor=cursor-value");
  });
});
