import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import nextConfig from "../next.config.mjs";

describe("security headers", () => {
  it("sends the required browser isolation and content protections", async () => {
    const routes = await nextConfig.headers?.();
    const headers = new Map(routes?.[0]?.headers.map((header) => [header.key, header.value]));

    expect(headers.get("Content-Security-Policy")).toContain("frame-src 'self' https://kinescope.io https://*.kinescope.io");
    const scriptSource = headers.get("Content-Security-Policy")?.split("; ").find((source) => source.startsWith("script-src"));
    expect(scriptSource).toBe("script-src 'self' 'nonce-__CSP_NONCE__' https://discord.com https://*.discord.com https://*.kinescope.io");
    expect(headers.get("Content-Security-Policy")).toContain("https://discord.com");
    expect(headers.get("Content-Security-Policy")).toContain("https://*.public.blob.vercel-storage.com");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("allows the apex Kinescope embed host in the per-request policy", () => {
    const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    expect(proxySource).toContain("frame-src 'self' https://kinescope.io https://*.kinescope.io");
  });
});
