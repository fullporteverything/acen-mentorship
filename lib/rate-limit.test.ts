import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDatabase, db } from "@/lib/db/client";
import { rateLimitBuckets } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/rate-limit";

if (!process.env.DATABASE_URL_TEST && existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_USE_TEST_URL = "true";

afterAll(async () => closeDatabase());

describe.skipIf(!process.env.DATABASE_URL_TEST)("persistent rate limiting", () => {
  it("atomically allows only the configured number of concurrent requests", async () => {
    const subject = `rate-test-${randomUUID()}`;
    const action = `concurrent-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeRateLimit(subject, action, { limit: 5, windowMs: 60_000 })
      )
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    const [bucket] = await db
      .select({ hitCount: rateLimitBuckets.hitCount })
      .from(rateLimitBuckets)
      .where(and(eq(rateLimitBuckets.scope, action), eq(rateLimitBuckets.bucketKey, subject)));
    expect(bucket.hitCount).toBe(5);
  }, 15_000);
});
