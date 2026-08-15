import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./proxy.ts", import.meta.url), "utf8");

describe("browser gate", () => {
  it("still refuses every non-Chrome browser", () => {
    // The Chrome-only policy is deliberate — this guards against it being
    // quietly relaxed while softening the page around it.
    expect(source).toMatch(/const isFirefox = \/Firefox\\\/\/\.test\(ua\)/);
    expect(source).toContain("if (isSafari || isFirefox) return false;");
    expect(source).toContain("status: 403");
  });

  it("lets a blocked browser through to the help desk", () => {
    expect(source).toContain(
      'const isSupport = pathname === "/support" || pathname.startsWith("/support/");'
    );
    expect(source).toContain("if (!isApi && !isSupport && !isChrome(req))");
  });

  it("offers help from the block page itself", () => {
    expect(source).toContain('<a href="/support">Get help</a>');
  });
});
