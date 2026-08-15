import { describe, expect, it } from "vitest";
import { upgradeLegacyMembershipProof } from "./membership-proof";

describe("legacy membership proof migration", () => {
  it("converts a previously role-verified OAuth session without retaining its access token", () => {
    const token = { sub: "member-1", accessToken: "legacy-secret", iat: 123 };
    expect(upgradeLegacyMembershipProof(token)).toMatchObject({
      sub: "member-1",
      memberVerifiedAt: 123_000,
    });
    expect(token).not.toHaveProperty("accessToken");
  });

  it("does not invent proof for an unverified token", () => {
    expect(upgradeLegacyMembershipProof({ sub: "member-1" })).not.toHaveProperty("memberVerifiedAt");
  });

  it("removes the legacy token without inventing proof when JWT issuance time is missing or invalid", () => {
    for (const iat of [undefined, Number.NaN, -1, "123", Number.MAX_SAFE_INTEGER]) {
      const token = { accessToken: "legacy-secret", iat };
      expect(upgradeLegacyMembershipProof(token)).not.toHaveProperty("memberVerifiedAt");
      expect(token).not.toHaveProperty("accessToken");
    }
  });
});
