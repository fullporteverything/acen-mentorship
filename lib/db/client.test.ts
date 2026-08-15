import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveDatabaseUrl } from "./client";

describe("database URL selection", () => {
  const runtimeUrl = "postgresql://runtime.example/database";
  const testUrl = "postgresql://test.example/database";

  it("always uses DATABASE_URL in production, even when a test URL is configured", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: runtimeUrl,
        DATABASE_URL_TEST: testUrl,
        DATABASE_USE_TEST_URL: "true",
      })
    ).toBe(runtimeUrl);
  });

  it("requires an explicit non-production opt-in before selecting DATABASE_URL_TEST", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: runtimeUrl,
        DATABASE_URL_TEST: testUrl,
      })
    ).toBe(runtimeUrl);
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "test",
        DATABASE_URL: runtimeUrl,
        DATABASE_URL_TEST: testUrl,
        DATABASE_USE_TEST_URL: "true",
      })
    ).toBe(testUrl);
  });

  it("fails closed when explicit test mode has no isolated URL", () => {
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: "test", DATABASE_USE_TEST_URL: "true" })
    ).toThrow("DATABASE_URL_TEST");
  });

  it("normalizes a connection URL accidentally wrapped in matching quotes", () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        DATABASE_URL: '"postgresql://user:pass@example.neon.tech/database?sslmode=require"',
      })
    ).toBe("postgresql://user:pass@example.neon.tech/database?sslmode=require");
  });

  it("rejects malformed or unsupported database URLs", () => {
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: '"not-a-url"' })
    ).toThrow("valid PostgreSQL URL");
    expect(() =>
      resolveDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: "https://example.com" })
    ).toThrow("valid PostgreSQL URL");
  });
});
