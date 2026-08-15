import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MyHomeworkCard from "@/components/MyHomeworkCard";
import type { HomeworkArchiveItem } from "@/lib/homework-archive";

const item = (overrides: Partial<HomeworkArchiveItem> = {}): HomeworkArchiveItem => ({
  id: "submission-1",
  lessonId: "core-1",
  lessonTitle: "Introduction",
  version: 2,
  fileName: "homework.pdf",
  submittedAt: "2026-08-15T12:00:00.000Z",
  status: "approved",
  feedback: "Strong work.",
  available: true,
  previewUrl: "/api/blob/dojo/homework/111/file.pdf?disposition=inline",
  downloadUrl: "/api/blob/dojo/homework/111/file.pdf?disposition=attachment",
  ...overrides,
});

describe("MyHomeworkCard", () => {
  it("shows only the latest three submissions with preview, download, and archive access", () => {
    const html = renderToStaticMarkup(<MyHomeworkCard items={[item({ id: "1" }), item({ id: "2", version: 1 }), item({ id: "3" }), item({ id: "4" })]} />);
    expect((html.match(/class="homework-archive-row"/g) ?? [])).toHaveLength(3);
    expect(html).toContain("Introduction");
    expect(html).toContain("Version 2");
    expect(html).toContain("Preview");
    expect(html).toContain("Download");
    expect(html).toContain("/dashboard/homework");
  });

  it("renders clear empty and unavailable states", () => {
    expect(renderToStaticMarkup(<MyHomeworkCard items={[]} />)).toContain("Your submitted homework will appear here");
    const html = renderToStaticMarkup(<MyHomeworkCard items={[item({ available: false, previewUrl: null, downloadUrl: null })]} />);
    expect(html).toContain("File unavailable");
    expect(html).not.toContain(">Download<");
  });

  it("shows a retryable archive error without breaking Overview", () => {
    const html = renderToStaticMarkup(<MyHomeworkCard items={[]} error />);
    expect(html).toContain("Homework archive is temporarily unavailable");
    expect(html).toContain("Try again");
  });
});
