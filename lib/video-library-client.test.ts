import { afterEach, describe, expect, it, vi } from "vitest";
import { assignVideoToLesson } from "./video-library-client";

describe("video assignment reconciliation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refetches the complete library after assignment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          videos: [
            { id: "video-a", attachedTo: "Core 02" },
            { id: "video-b", attachedTo: null },
          ],
          lessons: [
            { id: "core-01", title: "Core 01", videoId: "" },
            { id: "core-02", title: "Core 02", videoId: "video-a" },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const reconciled = await assignVideoToLesson("video-a", "core-02");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/lesson-overrides",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/videos");
    expect(reconciled.videos).toEqual([
      { id: "video-a", attachedTo: "Core 02" },
      { id: "video-b", attachedTo: null },
    ]);
    expect(reconciled.lessons[1]).toMatchObject({ videoId: "video-a" });
  });
});
