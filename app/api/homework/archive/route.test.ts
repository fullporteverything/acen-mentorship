import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  listHomeworkArchive: vi.fn(),
  progressViewerIds: vi.fn((id: string) => [id, "linked-alt"]),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@/lib/homework-archive", () => ({ listHomeworkArchive: mocks.listHomeworkArchive }));
vi.mock("@/lib/progress-link", () => ({ progressViewerIds: mocks.progressViewerIds }));

import { GET } from "./route";

describe("GET /api/homework/archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "main", ownerIds: ["legacy"], isAdmin: false });
    mocks.listHomeworkArchive.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  });

  it("preserves centralized authorization responses", async () => {
    mocks.requireMemberOrResponse.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    const response = await GET(new Request("http://localhost/api/homework/archive"));
    expect(response.status).toBe(503);
    expect(mocks.listHomeworkArchive).not.toHaveBeenCalled();
  });

  it("queries only linked identities with validated filters and bounded limits", async () => {
    const response = await GET(new Request("http://localhost/api/homework/archive?limit=999&lessonId=core-1&status=approved"));
    expect(response.status).toBe(200);
    expect(mocks.listHomeworkArchive).toHaveBeenCalledWith({
      discordIds: ["main", "linked-alt"],
      limit: 100,
      lessonId: "core-1",
      status: "approved",
      cursor: undefined,
    });
  });

  it("rejects invalid status and cursor values", async () => {
    expect((await GET(new Request("http://localhost/api/homework/archive?status=hacked"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/homework/archive?cursor=bad"))).status).toBe(400);
  });

  it("returns a retryable 503 when archive storage is temporarily unavailable", async () => {
    mocks.listHomeworkArchive.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(new Request("http://localhost/api/homework/archive"));
    expect(response.status).toBe(503);
  });
});
