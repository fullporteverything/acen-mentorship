export const PLATFORM_RECORD_FAMILIES = [
  "member",
  "progress",
  "homework",
  "journal",
  "security",
  "announcement",
  "receipt",
  "watch",
  "profile",
  "settings",
  "lesson_override",
  "added_lesson",
  "added_section",
  "caption_request",
  "file",
] as const;

export type PlatformRecordFamily = (typeof PLATFORM_RECORD_FAMILIES)[number];
export type RepositoryBackend = "blob" | "dual" | "postgres";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** A lossless logical record; `key` is stable across Blob and Postgres. */
export interface PlatformRecord {
  family: PlatformRecordFamily;
  key: string;
  memberId?: string;
  payload: JsonValue;
  updatedAt: string;
  sourcePath?: string;
  sourceChecksum?: string;
}

export interface PlatformRepository {
  readonly backend: RepositoryBackend;
  get(family: PlatformRecordFamily, key: string): Promise<PlatformRecord | null>;
  list(family?: PlatformRecordFamily): Promise<PlatformRecord[]>;
  put(record: PlatformRecord): Promise<PlatformRecord>;
}

export interface ShadowMismatch {
  family: PlatformRecordFamily;
  key: string;
  reason: "missing" | "payload_mismatch" | "timestamp_mismatch" | "shadow_failure";
}
