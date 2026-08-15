import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { rateLimitBuckets } from "@/lib/db/schema";

export type RateLimitPolicy = { limit: number; windowMs: number };
export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: Date };

/**
 * One atomic INSERT … ON CONFLICT statement. PostgreSQL acquires the unique
 * bucket row lock, so simultaneous callers cannot over-consume a window.
 */
export async function consumeRateLimit(subject: string, action: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + policy.windowMs);
  const result = await db.execute(sql`
    INSERT INTO rate_limit_buckets (scope, bucket_key, hit_count, window_started_at, reset_at)
    VALUES (${action}, ${subject}, 1, ${now}, ${resetAt})
    ON CONFLICT (scope, bucket_key) DO UPDATE SET
      hit_count = CASE WHEN rate_limit_buckets.reset_at <= ${now} THEN 1 ELSE rate_limit_buckets.hit_count + 1 END,
      window_started_at = CASE WHEN rate_limit_buckets.reset_at <= ${now} THEN ${now} ELSE rate_limit_buckets.window_started_at END,
      reset_at = CASE WHEN rate_limit_buckets.reset_at <= ${now} THEN ${resetAt} ELSE rate_limit_buckets.reset_at END,
      updated_at = ${now}
    WHERE rate_limit_buckets.reset_at <= ${now} OR rate_limit_buckets.hit_count < ${policy.limit}
    RETURNING hit_count, reset_at
  `);
  let row = (result.rows[0] ?? {}) as { hit_count?: number; reset_at?: Date | string };
  const allowed = Boolean(result.rows[0]);
  if (!allowed) {
    const [existing] = await db
      .select({ hitCount: rateLimitBuckets.hitCount, resetAt: rateLimitBuckets.resetAt })
      .from(rateLimitBuckets)
      .where(and(eq(rateLimitBuckets.scope, action), eq(rateLimitBuckets.bucketKey, subject)))
      .limit(1);
    if (existing) row = { hit_count: existing.hitCount, reset_at: existing.resetAt };
  }
  return { allowed, remaining: allowed ? Math.max(0, policy.limit - (row.hit_count ?? policy.limit)) : 0, resetAt: new Date(row.reset_at ?? resetAt) };
}
