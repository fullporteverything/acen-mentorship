import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@vercel/blob", () => mocks);

import { getSeenNotifications, markNotificationsSeen } from "./lesson-store";

describe("notification read receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.put.mockResolvedValue({});
  });

  it("keeps concurrent devices and Discord users in immutable private paths", async () => {
    await Promise.all([
      markNotificationsSeen("user-1", ["announcement:a"]),
      markNotificationsSeen("user-1", ["homework:b"]),
      markNotificationsSeen("user-2", ["announcement:a"]),
    ]);

    const paths = mocks.put.mock.calls.map((call) => call[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "dojo/notifications-seen/user-1/announcement%3Aa.json",
        "dojo/notifications-seen/user-1/homework%3Ab.json",
        "dojo/notifications-seen/user-2/announcement%3Aa.json",
      ])
    );
  });

  it("reads every page of receipts without making old notifications unread", async () => {
    mocks.list
      .mockResolvedValueOnce({
        blobs: [
          { pathname: "dojo/notifications-seen/user-1/announcement%3Aold.json" },
        ],
        hasMore: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        blobs: [
          { pathname: "dojo/notifications-seen/user-1/homework%3Anew.json" },
        ],
        hasMore: false,
        cursor: undefined,
      });

    await expect(getSeenNotifications("user-1")).resolves.toEqual([
      "announcement:old",
      "homework:new",
    ]);
    expect(mocks.list).toHaveBeenNthCalledWith(2, {
      prefix: "dojo/notifications-seen/user-1/",
      cursor: "next-page",
      storeId: undefined,
    });
  });
});
