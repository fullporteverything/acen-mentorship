import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdminOrResponse: vi.fn() }));

vi.mock("@/lib/authz", () => ({ requireAdminOrResponse: mocks.requireAdminOrResponse }));
vi.mock("@/lib/lesson-store", () => ({
  getAddedLessons: vi.fn(), getAddedSections: vi.fn(), saveAddedLessons: vi.fn(), saveAddedSections: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/admin/add-lesson authorization", () => {
  it("preserves a temporary Discord verification failure as 503", async () => {
    mocks.requireAdminOrResponse.mockResolvedValue(new Response(null, { status: 503 }));

    expect((await POST(new Request("http://localhost/api/admin/add-lesson", { method: "POST" }) as never)).status).toBe(503);
  });
});
