import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructWebhookEvent: vi.fn(),
  updateIdentityStatus: vi.fn(),
}));

vi.mock("@/lib/stripe-identity", () => ({ constructWebhookEvent: mocks.constructWebhookEvent }));
vi.mock("@/lib/onboarding-store", () => ({ updateIdentityStatus: mocks.updateIdentityStatus }));

import { POST } from "./route";

function request(body: string, signature?: string): never {
  return new Request("http://localhost/api/onboarding/identity/webhook", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body,
  }) as never;
}

describe("POST /api/onboarding/identity/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateIdentityStatus.mockResolvedValue(undefined);
  });

  it("rejects an unverifiable payload with 400 and never mutates status", async () => {
    mocks.constructWebhookEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = await POST(request("{}", "t=1,v1=deadbeef"));
    expect(res.status).toBe(400);
    expect(mocks.updateIdentityStatus).not.toHaveBeenCalled();
  });

  it("marks a session verified with the assembled name", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      type: "identity.verification_session.verified",
      data: { object: { id: "vs_123", verified_outputs: { first_name: "Jane", last_name: "Member" } } },
    });
    const res = await POST(request("{}", "sig"));
    expect(res.status).toBe(200);
    expect(await (res as Response).json()).toEqual({ received: true });
    expect(mocks.updateIdentityStatus).toHaveBeenCalledWith("vs_123", "verified", "Jane Member");
  });

  it("maps requires_input and canceled events", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      type: "identity.verification_session.requires_input",
      data: { object: { id: "vs_req" } },
    });
    await POST(request("{}", "sig"));
    expect(mocks.updateIdentityStatus).toHaveBeenCalledWith("vs_req", "requires_input");

    mocks.constructWebhookEvent.mockReturnValue({
      type: "identity.verification_session.canceled",
      data: { object: { id: "vs_cx" } },
    });
    await POST(request("{}", "sig"));
    expect(mocks.updateIdentityStatus).toHaveBeenCalledWith("vs_cx", "canceled");
  });

  it("ignores unrelated event types without erroring", async () => {
    mocks.constructWebhookEvent.mockReturnValue({
      type: "identity.verification_session.created",
      data: { object: { id: "vs_new" } },
    });
    const res = await POST(request("{}", "sig"));
    expect(res.status).toBe(200);
    expect(mocks.updateIdentityStatus).not.toHaveBeenCalled();
  });
});
