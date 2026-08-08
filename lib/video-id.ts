const KINESCOPE_VIDEO_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when a value is a canonical Kinescope UUID video ID. */
export function isKinescopeVideoId(value: unknown): value is string {
  return typeof value === "string" && KINESCOPE_VIDEO_ID.test(value);
}
