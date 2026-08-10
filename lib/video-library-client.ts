export interface LibraryVideo {
  id: string;
  title: string;
  createdAt: string;
  duration: number | null;
  status: string;
  progress: number | null;
  ready: boolean;
  error?: string;
  attachedTo: string | null;
}

export interface AssignableLesson {
  id: string;
  title: string;
  videoId: string;
}

export interface VideoLibraryData {
  videos: LibraryVideo[];
  lessons: AssignableLesson[];
}

export async function loadVideoLibrary(): Promise<VideoLibraryData> {
  const response = await fetch("/api/admin/videos");
  if (!response.ok) throw new Error("Couldn't load the video library.");
  const data = await response.json().catch(() => null);
  return {
    videos: Array.isArray(data?.videos) ? data.videos : [],
    lessons: Array.isArray(data?.lessons) ? data.lessons : [],
  };
}

export async function assignVideoToLesson(
  videoId: string,
  lessonId: string
): Promise<VideoLibraryData> {
  const response = await fetch("/api/admin/lesson-overrides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId, field: "videoId", value: videoId }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Assignment failed.");

  // The server is authoritative: reload every row so both the newly assigned
  // lesson and any lesson that previously used this video reconcile at once.
  return loadVideoLibrary();
}
