export interface WatchProgress {
  currentTime: number;
  duration: number;
  percent: number;
  completed: boolean;
  updatedAt: string;
}

interface WatchProgressInput {
  currentTime: number;
  duration: number;
  ended?: boolean;
  updatedAt?: string;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function normalizeWatchProgress(
  input: WatchProgressInput
): WatchProgress {
  const duration = finiteNonNegative(input.duration);
  let currentTime = Math.min(finiteNonNegative(input.currentTime), duration || 0);
  if (input.ended && duration > 0) currentTime = duration;
  const percent =
    duration > 0 ? Math.min(100, Math.round((currentTime / duration) * 100)) : 0;

  return {
    currentTime,
    duration,
    percent,
    completed: Boolean(input.ended) || percent >= 95,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

export function shouldResumeWatchProgress(
  progress: Pick<WatchProgress, "currentTime" | "percent">
): boolean {
  return progress.currentTime >= 5 && progress.percent < 95;
}
