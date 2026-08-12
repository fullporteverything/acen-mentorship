import { beforeEach, describe, expect, it, vi } from "vitest";

const VIDEO_ID = "21c39a46-fda5-4222-bec6-6a6be8b1a461";
const mocks = vi.hoisted(() => ({
  requireAdminOrResponse: vi.fn(),
  kinescopeFetch: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireAdminOrResponse: mocks.requireAdminOrResponse }));
vi.mock("@/lib/kinescope", () => ({ kinescopeFetch: mocks.kinescopeFetch }));
vi.mock("@vercel/blob", () => ({
  put: mocks.put,
  get: mocks.get,
  del: mocks.del,
}));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/admin/video-captions", {
    method: "POST",
    body: JSON.stringify({ videoId: VIDEO_ID }),
  });
}

function providerResponse(payload: unknown) {
  return { json: vi.fn().mockResolvedValue(payload) };
}

describe("POST /api/admin/video-captions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminOrResponse.mockResolvedValue({ discordId: "admin", isAdmin: true });
    mocks.del.mockResolvedValue(undefined);
  });

  it("does not enqueue when English captions already exist or are pending", async () => {
    mocks.kinescopeFetch.mockResolvedValueOnce(
      providerResponse({ data: { subtitles: [{ language: "en", status: "pending" }] } })
    );

    const data = await (await POST(request())).json();

    expect(data).toMatchObject({ ok: true, existing: true });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("returns 503 when Discord membership verification is unavailable", async () => {
    mocks.requireAdminOrResponse.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await POST(request())).status).toBe(503);
  });

  it("allows only one simultaneous request to enqueue captions", async () => {
    mocks.kinescopeFetch.mockImplementation((_path: string, options: RequestInit) =>
      options.method === "GET"
        ? Promise.resolve(providerResponse({ data: { subtitles: [] } }))
        : Promise.resolve(providerResponse({}))
    );
    mocks.put
      .mockResolvedValueOnce({ etag: "lease-1" })
      .mockRejectedValueOnce(new Error("already exists"));
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response(JSON.stringify({ acquiredAt: new Date().toISOString() })).body,
      blob: { etag: "lease-1" },
    });

    const responses = await Promise.all([POST(request()), POST(request())]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    const posts = mocks.kinescopeFetch.mock.calls.filter(
      ([, options]) => options.method === "POST"
    );

    expect(posts).toHaveLength(1);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ok: true }),
        expect.objectContaining({ ok: true, queued: true }),
      ])
    );
  });

  it("treats a provider conflict as success when the recheck finds captions", async () => {
    mocks.put.mockResolvedValue({ etag: "lease-1" });
    mocks.kinescopeFetch
      .mockResolvedValueOnce(providerResponse({ data: { subtitles: [] } }))
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce(
        providerResponse({ data: { subtitles: [{ language: "en" }] } })
      );

    const data = await (await POST(request())).json();

    expect(data).toMatchObject({ ok: true, existing: true });
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("releases the lease after a genuine failure so retry can enqueue", async () => {
    mocks.put.mockResolvedValue({ etag: "lease-1" });
    mocks.kinescopeFetch
      .mockResolvedValueOnce(providerResponse({ data: { subtitles: [] } }))
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce(providerResponse({ data: { subtitles: [] } }));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(mocks.del).toHaveBeenCalledWith(
      `dojo/caption-requests/${VIDEO_ID}.json`,
      { storeId: undefined, ifMatch: "lease-1" }
    );
  });
});
