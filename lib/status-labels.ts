/**
 * One vocabulary for homework review status, shared by the lesson page, the
 * dashboard card and the archive. Members never see the raw store values —
 * the legacy "rejected" decision reads as "Needs revision" everywhere, same as
 * the newer "revision_requested".
 */
export const STATUS_LABELS: Record<
  "pending" | "approved" | "rejected" | "revision_requested",
  string
> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Needs revision",
  revision_requested: "Needs revision",
};
