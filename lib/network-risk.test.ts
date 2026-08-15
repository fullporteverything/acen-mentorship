import { describe, expect, it, vi } from "vitest";

import { assessNetworkRisk } from "./network-risk";

describe("network risk", () => {
  it("uses HTTPS and fails open without strike state", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(assessNetworkRisk("203.0.113.8", fetcher)).resolves.toEqual({ blocked: false, state: "unavailable" });
    expect(fetcher.mock.calls[0][0]).toMatch(/^https:/);
  });
});
