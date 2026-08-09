export interface OverviewStatsInput {
  totalLessons: number;
  completedLessons: number;
  journalEntries: number;
}

export interface OverviewStatCard {
  label: string;
  value: string;
  sub: string;
  kanji: string;
}

export function buildOverviewStats({
  totalLessons,
  completedLessons,
  journalEntries,
}: OverviewStatsInput): OverviewStatCard[] {
  const total = Math.max(0, totalLessons);
  const completed = Math.min(total, Math.max(0, completedLessons));
  const entries = Math.max(0, journalEntries);

  return [
    {
      label: "Lectures",
      value: String(total),
      sub: `${completed} completed`,
      kanji: "修",
    },
    {
      label: "Journal",
      value: String(entries),
      sub: entries === 1 ? "entry" : "entries",
      kanji: "念",
    },
    {
      label: "Access",
      value: "Active",
      sub: "Private member",
      kanji: "礼",
    },
  ];
}
