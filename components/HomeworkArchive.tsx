import Link from "next/link";

import type { HomeworkArchiveItem } from "@/lib/homework-archive";

const STATUS_LABELS: Record<HomeworkArchiveItem["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Needs revision",
  revision_requested: "Needs revision",
};

export default function HomeworkArchive({
  items,
  nextCursor,
  selectedLesson,
  selectedStatus,
  lessonOptions,
}: {
  items: HomeworkArchiveItem[];
  nextCursor: string | null;
  selectedLesson?: string;
  selectedStatus?: string;
  lessonOptions?: Array<{ id: string; title: string }>;
}) {
  const groups = new Map<string, { title: string; items: HomeworkArchiveItem[] }>();
  for (const item of items) {
    const group = groups.get(item.lessonId) ?? { title: item.lessonTitle, items: [] };
    group.items.push(item);
    groups.set(item.lessonId, group);
  }
  const availableLessons = lessonOptions ?? [...new Map(items.map((item) => [item.lessonId, item.lessonTitle])).entries()].map(([id, title]) => ({ id, title }));
  const moreParams = new URLSearchParams();
  if (nextCursor) moreParams.set("cursor", nextCursor);
  if (selectedLesson) moreParams.set("lessonId", selectedLesson);
  if (selectedStatus) moreParams.set("status", selectedStatus);

  return (
    <>
      <form className="homework-archive-filters" method="get" aria-label="Filter homework archive">
        <label>
          Lesson
          <select name="lessonId" defaultValue={selectedLesson ?? ""}>
            <option value="">All lessons</option>
            {availableLessons.map(({ id, title }) => <option value={id} key={id}>{title}</option>)}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={selectedStatus ?? ""}>
            <option value="">All statuses</option>
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Needs revision</option>
            <option value="revision_requested">Revision requested</option>
          </select>
        </label>
        <button type="submit">Apply filters</button>
        {(selectedLesson || selectedStatus) && <Link href="/dashboard/homework">Clear</Link>}
      </form>

      {groups.size === 0 ? (
        <div className="homework-archive-page-empty">
          <span aria-hidden="true">文</span>
          <h2>No homework matches these filters.</h2>
          <p>Your submitted PDFs and review history will stay available here.</p>
        </div>
      ) : (
        <div className="homework-archive-groups">
          {[...groups.entries()].map(([lessonId, group]) => (
            <section className="homework-archive-group" key={lessonId}>
              <h2>{group.title}</h2>
              <div className="homework-archive-list">
                {group.items.map((item) => (
                  <article className="homework-archive-row homework-archive-row-full" key={item.id}>
                    <div className="homework-archive-row-copy">
                      <h3>Version {item.version}</h3>
                      <p>{new Date(item.submittedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · {item.fileName}</p>
                      {item.feedback && <blockquote>{item.feedback}</blockquote>}
                    </div>
                    <span className={`homework-status homework-status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                    <div className="homework-archive-actions">
                      {item.available && item.previewUrl && item.downloadUrl ? <>
                        <a href={item.previewUrl} target="_blank" rel="noreferrer">Preview</a>
                        <a href={item.downloadUrl}>Download</a>
                      </> : <span className="homework-file-unavailable">File unavailable</span>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {nextCursor && <Link className="homework-archive-load-more" href={`/dashboard/homework?${moreParams.toString()}`}>Load more</Link>}
    </>
  );
}
