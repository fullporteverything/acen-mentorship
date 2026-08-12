import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveDatabaseUrl } from "./client";

describe("database URL selection", () => {
  it("always uses DATABASE_URL in production, even when a test URL is configured", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: "runtime-connection",
        DATABASE_URL_TEST: "isolated-test-connection",
        DATABASE_USE_TEST_URL: "true",
      })
    ).toBe("runtime-connection");
  });

  it("requires an explicit non-production opt-in before selecting DATABASE_URL_TEST", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: "runtime-connection",
        DATABASE_URL_TEST: "isolated-test-connection",
      })
    ).toBe("runtime-connection");
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: "runtime-connection",
        DATABASE_URL_TEST: "isolated-test-connection",
        DATABASE_USE_TEST_URL: "true",
      })
    ).toBe("isolated-test-connection");
  });

  it("fails closed when explicit test mode has no isolated URL", () => {
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: "test", DATABASE_USE_TEST_URL: "true" })
    ).toThrow("DATABASE_URL_TEST");
  });
});
