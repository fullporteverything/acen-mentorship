import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  get: vi.fn(),
  isUploadAvailable: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@vercel/blob", () => ({ get: mocks.get }));
vi.mock("@/lib/upload-tracking", () => ({ isUploadAvailable: mocks.isUploadAvailable }));

import { GET } from "./route";

const call = (query = "") => GET(
  new NextRequest(`http://localhost/api/blob/dojo/homework/111/file.pdf${query}`),
  { params: Promise.resolve({ path: ["dojo", "homework", "111", "unsafe\"name.pdf"] }) }
);

describe("private Blob proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "111", ownerIds: ["111"], isAdmin: false });
    mocks.isUploadAvailable.mockResolvedValue(true);
    mocks.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("pdf")); controller.close(); } }), blob: { contentType: "application/pdf" } });
  });

  it("returns a safe inline PDF preview", async () => {
    const response = await call("?disposition=inline");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("downloads with a sanitized attachment filename", async () => {
    const response = await call("?disposition=attachment");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("content-disposition")).not.toContain('"name');
  });

  it("rejects invalid dispositions, other owners, and unavailable uploads", async () => {
    expect((await call("?disposition=popup")).status).toBe(400);
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "222", ownerIds: ["222"], isAdmin: false });
    expect((await call()).status).toBe(403);
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "111", ownerIds: ["111"], isAdmin: false });
    mocks.isUploadAvailable.mockResolvedValue(false);
    expect((await call()).status).toBe(423);
  });
});
