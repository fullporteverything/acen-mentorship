/**
 * GitHub-style consistency heatmap for journal entries. Server component —
 * takes the entries' createdAt strings and renders the last `weeks` weeks as a
 * 7-row grid, each cell shaded by how many entries landed that day.
 */

interface JournalHeatmapProps {
  dates: string[];
  weeks?: number;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const LEVELS = [
  "rgba(232,160,160,0.08)",
  "rgba(232,160,160,0.30)",
  "rgba(232,160,160,0.58)",
  "#E8A0A0",
];

export default function JournalHeatmap({ dates, weeks = 13 }: JournalHeatmapProps) {
  const counts = new Map<string, number>();
  for (const s of dates) {
    const d = new Date(s);
    if (isNaN(d.getTime())) continue;
    const k = dayKey(d);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const today = new Date();
  const totalDays = weeks * 7;
  const cells: { key: string; count: number }[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = dayKey(d);
    cells.push({ key: k, count: counts.get(k) || 0 });
  }

  const level = (c: number) => (c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : 3);

  return (
    <div style={{ display: "flex", gap: 3, overflowX: "auto" }}>
      {Array.from({ length: weeks }).map((_, w) => (
        <div key={w} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {Array.from({ length: 7 }).map((_, day) => {
            const cell = cells[w * 7 + day];
            if (!cell) return <div key={day} style={{ width: 10, height: 10 }} />;
            return (
              <div
                key={day}
                title={`${cell.key} — ${cell.count} ${cell.count === 1 ? "entry" : "entries"}`}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: LEVELS[level(cell.count)],
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
