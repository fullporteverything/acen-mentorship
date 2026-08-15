import Link from "next/link";

import type { HomeworkArchiveItem } from "@/lib/homework-archive";
import { STATUS_LABELS } from "@/lib/status-labels";

export default function MyHomeworkCard({ items, error = false }: { items: HomeworkArchiveItem[]; error?: boolean }) {
  return (
    <section className="homework-archive-card" aria-labelledby="homework-archive-title">
      <div className="homework-archive-header">
        <div>
          <p>Personal archive</p>
          <h2 id="homework-archive-title">My Homework</h2>
        </div>
        <Link href="/dashboard/homework">View full archive →</Link>
      </div>
      {error ? (
        <div className="homework-archive-empty" role="status">
          <p>Homework archive is temporarily unavailable.</p>
          <a href="/dashboard">Try again</a>
        </div>
      ) : items.length === 0 ? (
        <div className="homework-archive-empty">
          <span aria-hidden="true">文</span>
          <p>Your submitted homework will appear here.</p>
        </div>
      ) : (
        <div className="homework-archive-list">
          {items.slice(0, 3).map((item) => (
            <article className="homework-archive-row" key={item.id}>
              <div className="homework-archive-row-copy">
                <h3><Link href={`/dashboard/lessons/${item.lessonId}`}>{item.lessonTitle}</Link></h3>
                <p>
                  Version {item.version} · {new Date(item.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                </p>
              </div>
              <span className={`homework-status homework-status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
              <div className="homework-archive-actions">
                {item.available && item.previewUrl && item.downloadUrl ? (
                  <>
                    <a href={item.previewUrl} target="_blank" rel="noreferrer">Preview</a>
                    <a href={item.downloadUrl}>Download</a>
                  </>
                ) : (
                  <span className="homework-file-unavailable">File unavailable</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
