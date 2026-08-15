import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  announcements,
  auditEvents,
  auditOutbox,
  curriculumSections,
  homeworkRubricReviews,
  homeworkReviewCounters,
  homeworkSubmissionCounters,
  homeworkSubmissions,
  journalAttachments,
  journals,
  lessonBookmarks,
  lessonNotes,
  lessonProgress,
  lessons,
  legacyBlobRecords,
  migrationVerificationArtifacts,
  memberIdentities,
  members,
  migrationChecksums,
  migrationItems,
  migrationRuns,
  notificationReceipts,
  notifications,
  orphanedUploads,
  rateLimitBuckets,
  securityEvents,
  securityMemberState,
  supportMessages,
  supportTickets,
  transcriptCues,
  uploadQuarantine,
  uploads,
  watchProgress,
} from "./schema";

function config(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table);
}

function constraintNames(table: Parameters<typeof getTableConfig>[0]) {
  const tableConfig = config(table);
  return [
    ...tableConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
    ...tableConfig.uniqueConstraints.map((constraint) => constraint.getName()),
    ...tableConfig.checks.map((check) => check.name),
  ];
}

function indexNames(table: Parameters<typeof getTableConfig>[0]) {
  return config(table).indexes.map((index) => index.config.name);
}

describe("Neon transactional data model", () => {
  it("models every owned persistence domain with timestamps and member isolation", () => {
    const tables = [
      members,
      memberIdentities,
      curriculumSections,
      lessons,
      lessonProgress,
      watchProgress,
      homeworkSubmissionCounters,
      homeworkSubmissions,
      homeworkReviewCounters,
      homeworkRubricReviews,
      journals,
      journalAttachments,
      securityMemberState,
      securityEvents,
      announcements,
      notifications,
      notificationReceipts,
      supportTickets,
      supportMessages,
      transcriptCues,
      lessonNotes,
      lessonBookmarks,
      auditEvents,
      auditOutbox,
      rateLimitBuckets,
      migrationRuns,
      migrationItems,
      migrationChecksums,
      uploads,
      uploadQuarantine,
      orphanedUploads,
      legacyBlobRecords,
      migrationVerificationArtifacts,
    ];

    expect(tables).toHaveLength(33);
    for (const table of tables) {
      expect(config(table).columns.map((column) => column.name)).toContain("created_at");
      expect(config(table).columns.map((column) => column.name)).toContain("updated_at");
    }

    for (const table of [
      memberIdentities,
      lessonProgress,
      watchProgress,
      homeworkSubmissions,
      journals,
      notificationReceipts,
      supportTickets,
      lessonNotes,
      lessonBookmarks,
    ]) {
    expect(constraintNames(table).some((name) => name?.includes("member"))).toBe(true);
    }
  });

  it("makes identities, receipts, progress, and member-owned notes idempotent", () => {
    expect(constraintNames(members)).toContain("members_discord_id_unique");
    expect(constraintNames(memberIdentities)).toContain(
      "member_identities_provider_account_unique"
    );
    expect(constraintNames(notificationReceipts)).toContain(
      "notification_receipts_member_notification_unique"
    );
    expect(constraintNames(notificationReceipts)).toContain(
      "notification_receipts_notification_id_notifications_id_fk"
    );
    expect(constraintNames(lessonProgress)).toContain("lesson_progress_member_lesson_unique");
    expect(constraintNames(watchProgress)).toContain("watch_progress_member_lesson_unique");
    expect(constraintNames(lessonBookmarks)).toContain("lesson_bookmarks_member_lesson_cue_unique");
  });

  it("retains deleted records, immutable submission versions, lock rules, and import audit data", () => {
    for (const table of [members, curriculumSections, lessons, announcements, notifications, supportTickets]) {
      expect(config(table).columns.map((column) => column.name)).toContain("deleted_at");
    }

    expect(constraintNames(homeworkSubmissions)).toContain(
      "homework_submissions_member_lesson_version_unique"
    );
    expect(constraintNames(homeworkSubmissions)).toContain("homework_submissions_id_member_unique");
    expect(constraintNames(homeworkRubricReviews)).toContain(
      "homework_rubric_reviews_submission_version_unique"
    );
    expect(constraintNames(homeworkRubricReviews)).toContain(
      "homework_rubric_reviews_submission_member_owner_fk"
    );
    expect(constraintNames(securityMemberState)).toContain("security_member_state_valid_lock");
    expect(constraintNames(rateLimitBuckets)).toContain("rate_limit_buckets_scope_key_unique");
    expect(constraintNames(migrationRuns)).toContain("migration_runs_name_unique");
    expect(constraintNames(migrationItems)).toContain("migration_items_run_source_key_unique");
    expect(constraintNames(migrationChecksums)).toContain("migration_checksums_run_table_unique");
    expect(constraintNames(legacyBlobRecords)).toContain("legacy_blob_records_family_key_unique");
    expect(constraintNames(migrationVerificationArtifacts)).not.toContain("migration_verification_artifacts_source_unique");
    expect(indexNames(migrationVerificationArtifacts)).toContain("migration_verification_artifacts_source_index");
    expect(constraintNames(migrationVerificationArtifacts)).toContain("migration_verification_artifacts_expiry_bounded");
  });

  it("keeps collaboration, transcript, upload quarantine, and audit records relational", () => {
    expect(constraintNames(journals)).toContain("journals_member_id_members_id_fk");
    expect(constraintNames(journalAttachments)).toContain("journal_attachments_journal_id_journals_id_fk");
    expect(constraintNames(supportMessages)).toContain("support_messages_ticket_id_support_tickets_id_fk");
    expect(constraintNames(transcriptCues)).toContain("transcript_cues_lesson_id_lessons_id_fk");
    expect(constraintNames(lessonNotes)).toContain("lesson_notes_member_id_members_id_fk");
    expect(constraintNames(uploads)).toContain("uploads_member_id_members_id_fk");
    expect(constraintNames(uploadQuarantine)).toContain("upload_quarantine_upload_id_uploads_id_fk");
    expect(constraintNames(orphanedUploads)).toContain("orphaned_uploads_upload_id_uploads_id_fk");
    expect(constraintNames(auditEvents)).toContain("audit_events_member_id_members_id_fk");
  });
});
