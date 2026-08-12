import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    discordId: varchar("discord_id", { length: 32 }).notNull(),
    legacyUserId: varchar("legacy_user_id", { length: 128 }),
    displayName: varchar("display_name", { length: 255 }),
    avatarUrl: text("avatar_url"),
    ...softDelete,
    ...timestamps,
  },
  (table) => [
    unique("members_discord_id_unique").on(table.discordId),
    unique("members_legacy_user_id_unique").on(table.legacyUserId),
  ]
);

export const memberIdentities = pgTable(
  "member_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
    providerData: jsonb("provider_data").notNull().default({}),
    ...timestamps,
  },
  (table) => [
    unique("member_identities_provider_account_unique").on(table.provider, table.providerAccountId),
    index("member_identities_member_id_index").on(table.memberId),
  ]
);

export const curriculumSections = pgTable(
  "curriculum_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 160 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    position: integer("position").notNull(),
    ...softDelete,
    ...timestamps,
  },
  (table) => [unique("curriculum_sections_slug_unique").on(table.slug), unique("curriculum_sections_position_unique").on(table.position)]
);

export const lessons = pgTable(
  "lessons",
  {
    id: varchar("id", { length: 160 }).primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => curriculumSections.id),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    videoId: varchar("video_id", { length: 255 }),
    position: integer("position").notNull(),
    published: boolean("published").notNull().default(false),
    metadata: jsonb("metadata").notNull().default({}),
    ...softDelete,
    ...timestamps,
  },
  (table) => [
    unique("lessons_section_position_unique").on(table.sectionId, table.position),
    index("lessons_section_id_index").on(table.sectionId),
  ]
);

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    progress: integer("progress").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("lesson_progress_member_lesson_unique").on(table.memberId, table.lessonId),
    check("lesson_progress_valid_percentage", sql`${table.progress} >= 0 AND ${table.progress} <= 100`),
  ]
);

export const watchProgress = pgTable(
  "watch_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    unique("watch_progress_member_lesson_unique").on(table.memberId, table.lessonId),
    check("watch_progress_valid_seconds", sql`${table.watchedSeconds} >= 0 AND ${table.durationSeconds} >= 0`),
  ]
);

export const homeworkSubmissionCounters = pgTable(
  "homework_submission_counters",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    nextVersion: integer("next_version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("homework_submission_counters_member_lesson_unique").on(table.memberId, table.lessonId),
    check("homework_submission_counters_positive_next_version", sql`${table.nextVersion} > 0`),
  ]
);

export const homeworkSubmissions = pgTable(
  "homework_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull().default("application/pdf"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("homework_submissions_member_lesson_version_unique").on(table.memberId, table.lessonId, table.version),
    unique("homework_submissions_id_member_unique").on(table.id, table.memberId),
    unique("homework_submissions_storage_key_unique").on(table.storageKey),
    check("homework_submissions_positive_version", sql`${table.version} > 0`),
  ]
);

export const homeworkReviewCounters = pgTable(
  "homework_review_counters",
  {
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => homeworkSubmissions.id),
    nextVersion: integer("next_version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique("homework_review_counters_submission_unique").on(table.submissionId),
    check("homework_review_counters_positive_next_version", sql`${table.nextVersion} > 0`),
  ]
);

export const homeworkRubricReviews = pgTable(
  "homework_rubric_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => homeworkSubmissions.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    reviewerMemberId: uuid("reviewer_member_id").references(() => members.id),
    version: integer("version").notNull(),
    decision: varchar("decision", { length: 16 }).notNull(),
    feedback: text("feedback").notNull().default(""),
    rubric: jsonb("rubric").notNull().default({}),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.submissionId, table.memberId],
      foreignColumns: [homeworkSubmissions.id, homeworkSubmissions.memberId],
      name: "homework_rubric_reviews_submission_member_owner_fk",
    }),
    unique("homework_rubric_reviews_submission_version_unique").on(table.submissionId, table.version),
    check("homework_rubric_reviews_positive_version", sql`${table.version} > 0`),
    check("homework_rubric_reviews_valid_decision", sql`${table.decision} IN ('approved', 'rejected', 'revision_requested')`),
  ]
);

export const journals = pgTable(
  "journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    mood: varchar("mood", { length: 64 }),
    tags: jsonb("tags").notNull().default([]),
    feedback: text("feedback"),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    ...softDelete,
    ...timestamps,
  },
  (table) => [index("journals_member_created_index").on(table.memberId, table.createdAt)]
);

export const journalAttachments = pgTable(
  "journal_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => journals.id),
    storageKey: text("storage_key").notNull(),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("journal_attachments_storage_key_unique").on(table.storageKey),
    check("journal_attachments_nonnegative_size", sql`${table.byteSize} >= 0`),
  ]
);

export const securityMemberState = pgTable(
  "security_member_state",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => members.id),
    strikeCount: integer("strike_count").notNull().default(0),
    strikeLimit: integer("strike_limit").notNull().default(3),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockReason: text("lock_reason"),
    ...timestamps,
  },
  (table) => [
    check("security_member_state_nonnegative_strikes", sql`${table.strikeCount} >= 0 AND ${table.strikeLimit} > 0`),
    check("security_member_state_valid_lock", sql`${table.lockedAt} IS NULL OR ${table.strikeCount} >= ${table.strikeLimit}`),
  ]
);

export const securityEvents = pgTable(
  "security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    ipHash: varchar("ip_hash", { length: 128 }),
    details: jsonb("details").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [index("security_events_member_occurred_index").on(table.memberId, table.occurredAt)]
);

export const announcements = pgTable(
  "announcements",
  {
    id: varchar("id", { length: 160 }).primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    ...softDelete,
    ...timestamps,
  }
);

export const notifications = pgTable(
  "notifications",
  {
    id: varchar("id", { length: 160 }).primaryKey(),
    memberId: uuid("member_id").references(() => members.id),
    announcementId: varchar("announcement_id", { length: 160 }).references(() => announcements.id),
    notificationType: varchar("notification_type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
    ...softDelete,
    ...timestamps,
  },
  (table) => [index("notifications_member_delivered_index").on(table.memberId, table.deliveredAt)]
);

export const notificationReceipts = pgTable(
  "notification_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    notificationId: varchar("notification_id", { length: 160 })
      .notNull()
      .references(() => notifications.id),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique("notification_receipts_member_notification_unique").on(table.memberId, table.notificationId),
    index("notification_receipts_member_seen_index").on(table.memberId, table.seenAt),
  ]
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    subject: varchar("subject", { length: 255 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...softDelete,
    ...timestamps,
  },
  (table) => [index("support_tickets_member_status_index").on(table.memberId, table.status)]
);

export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id),
    authorMemberId: uuid("author_member_id").references(() => members.id),
    body: text("body").notNull(),
    internal: boolean("internal").notNull().default(false),
    ...timestamps,
  },
  (table) => [index("support_messages_ticket_created_index").on(table.ticketId, table.createdAt)]
);

export const transcriptCues = pgTable(
  "transcript_cues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    startMilliseconds: integer("start_milliseconds").notNull(),
    endMilliseconds: integer("end_milliseconds").notNull(),
    text: text("text").notNull(),
    locale: varchar("locale", { length: 32 }).notNull().default("en"),
    ...timestamps,
  },
  (table) => [
    unique("transcript_cues_lesson_start_locale_unique").on(table.lessonId, table.startMilliseconds, table.locale),
    check("transcript_cues_valid_range", sql`${table.startMilliseconds} >= 0 AND ${table.endMilliseconds} >= ${table.startMilliseconds}`),
  ]
);

export const lessonNotes = pgTable(
  "lesson_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    body: text("body").notNull(),
    ...softDelete,
    ...timestamps,
  },
  (table) => [index("lesson_notes_member_lesson_index").on(table.memberId, table.lessonId)]
);

export const lessonBookmarks = pgTable(
  "lesson_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    lessonId: varchar("lesson_id", { length: 160 })
      .notNull()
      .references(() => lessons.id),
    cueId: uuid("cue_id").references(() => transcriptCues.id),
    timestampMilliseconds: integer("timestamp_milliseconds").notNull(),
    label: varchar("label", { length: 255 }),
    ...timestamps,
  },
  (table) => [
    unique("lesson_bookmarks_member_lesson_cue_unique").on(table.memberId, table.lessonId, table.cueId),
    check("lesson_bookmarks_nonnegative_timestamp", sql`${table.timestampMilliseconds} >= 0`),
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id").references(() => members.id),
    actorMemberId: uuid("actor_member_id").references(() => members.id),
    action: varchar("action", { length: 160 }).notNull(),
    resourceType: varchar("resource_type", { length: 128 }).notNull(),
    resourceId: varchar("resource_id", { length: 255 }),
    details: jsonb("details").notNull().default({}),
    ...timestamps,
  },
  (table) => [index("audit_events_member_created_index").on(table.memberId, table.createdAt)]
);

export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: varchar("scope", { length: 128 }).notNull(),
    bucketKey: varchar("bucket_key", { length: 255 }).notNull(),
    hitCount: integer("hit_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("rate_limit_buckets_scope_key_unique").on(table.scope, table.bucketKey),
    check("rate_limit_buckets_nonnegative_hits", sql`${table.hitCount} >= 0`),
  ]
);

export const migrationRuns = pgTable(
  "migration_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    source: varchar("source", { length: 255 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: varchar("status", { length: 32 }).notNull().default("running"),
    /** Immutable source evidence for a verifier-created cutover run. */
    sourceManifest: jsonb("source_manifest"),
    sourceManifestChecksum: varchar("source_manifest_checksum", { length: 128 }),
    sourceScope: text("source_scope"),
    ...timestamps,
  },
  (table) => [unique("migration_runs_name_unique").on(table.name)]
);

export const migrationItems = pgTable(
  "migration_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id),
    sourceKey: text("source_key").notNull(),
    targetTable: varchar("target_table", { length: 128 }).notNull(),
    targetId: varchar("target_id", { length: 255 }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    error: text("error"),
    ...timestamps,
  },
  (table) => [unique("migration_items_run_source_key_unique").on(table.runId, table.sourceKey)]
);

export const migrationChecksums = pgTable(
  "migration_checksums",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id),
    tableName: varchar("table_name", { length: 128 }).notNull(),
    rowCount: integer("row_count").notNull().default(0),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("migration_checksums_run_table_unique").on(table.runId, table.tableName),
    check("migration_checksums_nonnegative_rows", sql`${table.rowCount} >= 0`),
  ]
);

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    storageKey: text("storage_key").notNull(),
    fileName: varchar("file_name", { length: 512 }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: varchar("sha256", { length: 128 }),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    ...softDelete,
    ...timestamps,
  },
  (table) => [
    unique("uploads_storage_key_unique").on(table.storageKey),
    check("uploads_nonnegative_size", sql`${table.byteSize} >= 0`),
  ]
);

export const uploadQuarantine = pgTable(
  "upload_quarantine",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id),
    reason: text("reason").notNull(),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique("upload_quarantine_upload_unique").on(table.uploadId)]
);

export const orphanedUploads = pgTable(
  "orphaned_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique("orphaned_uploads_upload_unique").on(table.uploadId)]
);

/**
 * Lossless, idempotent staging rows for legacy Blob records. Task 3 writes
 * here only on an isolated verification database; production reads stay Blob.
 */
export const legacyBlobRecords = pgTable(
  "legacy_blob_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    family: varchar("family", { length: 64 }).notNull(),
    recordKey: text("record_key").notNull(),
    memberDiscordId: varchar("member_discord_id", { length: 128 }),
    payload: jsonb("payload").notNull(),
    sourcePath: text("source_path"),
    sourceChecksum: varchar("source_checksum", { length: 128 }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("legacy_blob_records_family_key_unique").on(table.family, table.recordKey),
    index("legacy_blob_records_member_family_index").on(table.memberDiscordId, table.family),
  ]
);

/** Persisted evidence required before a runtime Postgres cutover is allowed. */
export const migrationVerificationArtifacts = pgTable(
  "migration_verification_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id),
    sourceManifestChecksum: varchar("source_manifest_checksum", { length: 128 }).notNull(),
    destinationManifestChecksum: varchar("destination_manifest_checksum", { length: 128 }).notNull(),
    mismatchCount: integer("mismatch_count").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    /** HMAC issued exclusively by the migration verifier. */
    verificationSeal: varchar("verification_seal", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("migration_verification_artifacts_source_index").on(table.sourceManifestChecksum),
    check("migration_verification_artifacts_nonnegative_mismatches", sql`${table.mismatchCount} >= 0`),
    check(
      "migration_verification_artifacts_expiry_bounded",
      sql`${table.expiresAt} > ${table.verifiedAt} and ${table.expiresAt} <= ${table.verifiedAt} + interval '30 minutes'`
    ),
  ]
);

export type MemberRow = typeof members.$inferSelect;
export type MemberInsert = typeof members.$inferInsert;
export type HomeworkSubmissionRow = typeof homeworkSubmissions.$inferSelect;
export type HomeworkReviewRow = typeof homeworkRubricReviews.$inferSelect;
export type JournalRow = typeof journals.$inferSelect;
