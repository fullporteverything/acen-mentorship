import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import nextConfig from "../next.config.mjs";

describe("security headers", () => {
  it("sends the isolation + transport headers on every route", async () => {
    const routes = await nextConfig.headers?.();
    const all = routes?.find((r) => r.source === "/(.*)");
    const headers = new Map(all?.headers.map((h) => [h.key, h.value]));

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
  });

  it("does NOT ship a page CSP from config — that would double the per-request one", () => {
    // The page CSP (with a live nonce) is emitted by proxy.ts. A static config
    // CSP here previously shipped a dead `__CSP_NONCE__` placeholder alongside
    // it; guard against that regression.
    const src = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
    expect(src).not.toContain("__CSP_NONCE__");
  });

  it("locks the JSON API surface to a no-load CSP", async () => {
    const routes = await nextConfig.headers?.();
    const api = routes?.find((r) => r.source === "/api/:path*");
    const csp = api?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("disables the X-Powered-By framework banner", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("emits a nonce'd page CSP with the required hosts in the middleware", () => {
    const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
    expect(proxySource).toContain("frame-src 'self' https://kinescope.io https://*.kinescope.io");
    expect(proxySource).toContain("'nonce-${nonce}'");
    expect(proxySource).toContain("form-action 'self'");
    // The nonce must be wired into the REQUEST header, or Next never applies it.
    expect(proxySource).toContain('requestHeaders.set("Content-Security-Policy"');
  });
});
