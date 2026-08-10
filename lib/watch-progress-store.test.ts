import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchProgress } from "./watch-progress";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => mocks);

import {
  getWatchProgress,
  saveWatchProgress,
} from "./watch-progress-store";

function watched(percent: number, completed = false): WatchProgress {
  return {
    currentTime: percent,
    duration: 100,
    percent,
    completed,
    updatedAt: new Date(2026, 0, 1, 0, 0, percent).toISOString(),
  };
}

function blob(pathname: string) {
  return { pathname, url: "", downloadUrl: "", size: 1, uploadedAt: new Date() };
}

describe("watch progress persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.put.mockResolvedValue({});
  });

  it("stores simultaneous lesson saves in separate checkpoint paths", async () => {
    await Promise.all([
      saveWatchProgress("user-1", "lesson-1", watched(20)),
      saveWatchProgress("user-1", "lesson-2", watched(40)),
    ]);

    const paths = mocks.put.mock.calls.map((call) => call[0]);
    expect(paths).toContain("dojo/watch-progress/user-1/lesson-1/020.json");
    expect(paths).toContain("dojo/watch-progress/user-1/lesson-2/040.json");
  });

  it("keeps reversed cross-instance saves in independent checkpoints", async () => {
    let releaseLow!: () => void;
    const lowBlocked = new Promise<void>((resolve) => {
      releaseLow = resolve;
    });
    mocks.put.mockImplementation(async (pathname: string) => {
      if (pathname.endsWith("020.json")) await lowBlocked;
      return {};
    });

    const low = saveWatchProgress("user-1", "lesson-1", watched(20));
    const high = saveWatchProgress("user-1", "lesson-1", watched(80));
    await high;
    releaseLow();
    await low;

    expect(mocks.put.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining([
        "dojo/watch-progress/user-1/lesson-1/020.json",
        "dojo/watch-progress/user-1/lesson-1/080.json",
      ])
    );
  });

  it("resolves resume progress from the highest checkpoint", async () => {
    mocks.list.mockResolvedValue({
      blobs: [
        blob("dojo/watch-progress/user-1/lesson-1/020.json"),
        blob("dojo/watch-progress/user-1/lesson-1/080.json"),
      ],
      hasMore: false,
      cursor: undefined,
    });
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(JSON.stringify(watched(80))).body,
    });

    await expect(getWatchProgress("user-1", "lesson-1")).resolves.toMatchObject({
      percent: 80,
    });
    expect(mocks.get).toHaveBeenCalledWith(
      "dojo/watch-progress/user-1/lesson-1/080.json",
      expect.any(Object)
    );
  });
});
