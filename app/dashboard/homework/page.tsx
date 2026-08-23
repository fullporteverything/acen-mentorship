import Link from "next/link";
import { redirect } from "next/navigation";

import HomeworkArchive from "@/components/HomeworkArchive";
import TopNav from "@/components/TopNav";
import { requireMember, rethrowTemporaryAuthorizationError } from "@/lib/authz";
import { listHomeworkArchive, type HomeworkArchiveStatus } from "@/lib/homework-archive";
import { progressViewerIds } from "@/lib/progress-link";

export const dynamic = "force-dynamic";

const statuses = new Set<HomeworkArchiveStatus>(["pending", "approved", "rejected", "revision_requested"]);

export default async function HomeworkArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requireMember().catch((error) => rethrowTemporaryAuthorizationError(error) ?? redirect("/"));
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  const selectedStatus = value("status");
  const status = selectedStatus && statuses.has(selectedStatus as HomeworkArchiveStatus)
    ? selectedStatus as HomeworkArchiveStatus
    : undefined;
  let page;
  try {
    page = await listHomeworkArchive({
      discordIds: progressViewerIds(identity.discordId),
      limit: 50,
      cursor: value("cursor"),
      lessonId: value("lessonId"),
      status,
    });
  } catch {
    page = null;
  }

  return (
    <div className="scrollable homework-archive-page">
      <TopNav active="/dashboard" />
      <main>
        <div className="homework-archive-page-heading">
          <div>
            <p>Personal archive</p>
            <h1>My Homework</h1>
            <span>Every submitted PDF and review stays here for you.</span>
          </div>
          <Link href="/dashboard">← Back to The Lobby</Link>
        </div>
        {page ? (
          <HomeworkArchive
            items={page.items}
            nextCursor={page.nextCursor}
            selectedLesson={value("lessonId")}
            selectedStatus={status}
            lessonOptions={page.lessons}
          />
        ) : (
          <div className="homework-archive-page-empty" role="status">
            <h2>Homework archive is temporarily unavailable.</h2>
            <p>Your saved work has not been removed.</p>
            <a href="/dashboard/homework">Try again</a>
          </div>
        )}
      </main>
    </div>
  );
}
