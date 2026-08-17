import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMemberOrResponse: vi.fn(),
  consumeRateLimit: vi.fn(),
  recordNdaSignature: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({ requireMemberOrResponse: mocks.requireMemberOrResponse }));
vi.mock("@/lib/mutation-security", () => ({ allowMutation: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/onboarding-store", () => ({ recordNdaSignature: mocks.recordNdaSignature }));

import { POST } from "./route";

function request(body: unknown): never {
  return new Request("http://localhost/api/onboarding/sign-nda", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    body: JSON.stringify(body),
  }) as never;
}

const validBody = { legalName: "Jane Q. Member", consentAgree: true, consentEsign: true };

describe("POST /api/onboarding/sign-nda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMemberOrResponse.mockResolvedValue({ discordId: "member-1", name: "Jane", isAdmin: false });
    mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: new Date() });
    mocks.recordNdaSignature.mockResolvedValue(undefined);
  });

  it("passes through the auth failure response without recording", async () => {
    const denied = new Response(null, { status: 401 });
    mocks.requireMemberOrResponse.mockResolvedValue(denied);
    const res = await POST(request(validBody));
    expect(res.status).toBe(401);
    expect(mocks.recordNdaSignature).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    mocks.consumeRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });
    const res = await POST(request(validBody));
    expect(res.status).toBe(429);
    expect(mocks.recordNdaSignature).not.toHaveBeenCalled();
  });

  it("rejects an empty or too-short legal name", async () => {
    for (const legalName of ["", " ", "A"]) {
      const res = await POST(request({ ...validBody, legalName }));
      expect(res.status).toBe(400);
    }
    expect(mocks.recordNdaSignature).not.toHaveBeenCalled();
  });

  it("rejects an over-long legal name", async () => {
    const res = await POST(request({ ...validBody, legalName: "x".repeat(121) }));
    expect(res.status).toBe(400);
    expect(mocks.recordNdaSignature).not.toHaveBeenCalled();
  });

  it("rejects when either consent is missing", async () => {
    expect((await POST(request({ ...validBody, consentAgree: false }))).status).toBe(400);
    expect((await POST(request({ ...validBody, consentEsign: false }))).status).toBe(400);
    expect(mocks.recordNdaSignature).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const bad = new Request("http://localhost/api/onboarding/sign-nda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }) as never;
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });

  it("records the signature with the first x-forwarded-for hop and returns ok", async () => {
    const res = await POST(request(validBody));
    expect(res.status).toBe(200);
    expect(await (res as Response).json()).toEqual({ ok: true });
    expect(mocks.recordNdaSignature).toHaveBeenCalledTimes(1);
    const arg = mocks.recordNdaSignature.mock.calls[0][0];
    expect(arg).toMatchObject({
      discordId: "member-1",
      legalName: "Jane Q. Member",
      ip: "203.0.113.7",
    });
    expect(typeof arg.ndaVersion).toBe("number");
    expect(arg.ndaHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
