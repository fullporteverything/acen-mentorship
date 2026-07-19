import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import TopNav from "@/components/TopNav";
import PhiBackdrop from "@/components/PhiBackdrop";
import JournalComposer from "@/components/JournalComposer";
import { getJournal, saveJournal, type JournalEntry } from "@/lib/journal-store";

export const dynamic = "force-dynamic";

const MAX_ENTRY = 5000;

/**
 * Journal — layout mirrors the reference (houseofapostles):
 *   Header    ← "My Journal" serif + small-caps subtitle with rule
 *   Streak    ← 🔥 X day streak pill, top-right of the header
 *   Composer  ← single textarea + live n/5000 + Post Entry button
 *   Entries   ← minimal cards: timestamp + body (delete on hover)
 *   Backdrop  ← drifting Φ marks (dojo-flavored version of APOSTLES letters)
 */
export default async function JournalPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const discordId = session.user.discordId || session.user.id || "unknown";
  const entries = await getJournal(discordId);
  const streak = computeStreak(entries);

  async function createEntry(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const uid = s.user.discordId || s.user.id || "unknown";

    const body = String(formData.get("body") ?? "").trim().slice(0, MAX_ENTRY);
    if (!body) return;

    const entry: JournalEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: "",
      body,
      mood: "",
      createdAt: new Date().toISOString(),
    };

    const current = await getJournal(uid);
    await saveJournal(uid, [entry, ...current]);
    revalidatePath("/dashboard/journal");
  }

  async function deleteEntry(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const uid = s.user.discordId || s.user.id || "unknown";
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const current = await getJournal(uid);
    await saveJournal(uid, current.filter((e) => e.id !== id));
    revalidatePath("/dashboard/journal");
  }

  return (
    <div className="scrollable" style={{ background: "#000000", position: "relative" }}>
      <TopNav active="/dashboard/journal" />

      {/* Ambient drifting-Φ layer */}
      <PhiBackdrop />

      <main
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 76,
          padding: "72px 40px 96px",
          minHeight: "calc(100vh - 76px)",
        }}
      >
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {/* Header row: title/subtitle left, streak card right */}
          <header
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 24,
              marginBottom: 40,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 260 }}>
              <h1
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 42,
                  fontWeight: 500,
                  letterSpacing: 1,
                  color: "#E8A0A0",
                  marginBottom: 14,
                }}
              >
                My Journal
              </h1>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 48,
                    height: 1,
                    background: "rgba(232,160,160,0.55)",
                  }}
                />
                <p
                  style={{
                    fontSize: 11,
                    letterSpacing: 4,
                    color: "rgba(245,240,240,0.7)",
                    textTransform: "uppercase",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  Private journal between you and your mentor
                </p>
              </div>
            </div>

            <StreakPill count={streak} />
          </header>

          {/* Composer */}
          <section style={{ marginBottom: 64 }}>
            <JournalComposer action={createEntry} />
          </section>

          {/* Entries */}
          <section>
            {entries.length === 0 ? (
              <div
                style={{
                  border: "1px dashed rgba(232,160,160,0.18)",
                  padding: "44px 28px",
                  textAlign: "center",
                  color: "rgba(245,240,240,0.4)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 13,
                }}
              >
                No entries yet. Your first post starts the streak.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {entries.map((e) => (
                  <EntryCard key={e.id} entry={e} onDelete={deleteEntry} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function StreakPill({ count }: { count: number }) {
  return (
    <div
      style={{
        border: "1px solid rgba(232,160,160,0.25)",
        background: "rgba(232,160,160,0.04)",
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        minWidth: 148,
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
        🔥
      </span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span
          style={{
            fontFamily: "'Cormorant Garamond', Georgia, serif",
            fontSize: 24,
            fontWeight: 500,
            color: "#F5F0F0",
          }}
        >
          {count}
        </span>
        <span
          style={{
            fontSize: 10,
            letterSpacing: 2,
            color: "rgba(245,240,240,0.55)",
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            marginTop: 2,
          }}
        >
          day streak
        </span>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  onDelete,
}: {
  entry: JournalEntry;
  onDelete: (formData: FormData) => Promise<void>;
}) {
  const d = new Date(entry.createdAt);
  const stamp = `${d.toLocaleDateString()}, ${d.toLocaleTimeString()}`;

  return (
    <article
      className="journal-entry"
      style={{
        position: "relative",
        border: "1px solid rgba(232,160,160,0.12)",
        background: "rgba(0,0,0,0.5)",
        padding: "20px 24px 22px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "rgba(245,240,240,0.45)",
            fontFamily: "Georgia, serif",
            letterSpacing: 1,
          }}
        >
          {stamp}
        </span>

        <form action={onDelete} className="journal-delete">
          <input type="hidden" name="id" value={entry.id} />
          <button
            type="submit"
            aria-label="Delete entry"
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(232,160,160,0.5)",
              cursor: "pointer",
              fontFamily: "Georgia, serif",
              fontSize: 10,
              letterSpacing: 2,
              textTransform: "uppercase",
              padding: 0,
            }}
          >
            Delete
          </button>
        </form>
      </header>

      <p
        style={{
          fontSize: 15,
          color: "rgba(245,240,240,0.9)",
          fontFamily: "Georgia, serif",
          lineHeight: 1.9,
          whiteSpace: "pre-wrap",
          wordWrap: "break-word",
        }}
      >
        {entry.body}
      </p>
    </article>
  );
}

/**
 * Consecutive-day streak ending at the most recent entry.
 * Uses local calendar days.
 */
function computeStreak(entries: JournalEntry[]): number {
  if (entries.length === 0) return 0;

  const days = new Set<string>();
  for (const e of entries) {
    const d = new Date(e.createdAt);
    if (isNaN(d.getTime())) continue;
    days.add(dayKey(d));
  }
  if (days.size === 0) return 0;

  // Start from today if there's an entry today, otherwise start from the most
  // recent entry's day (so a streak is still visible if you haven't posted yet
  // today but had one yesterday).
  const today = dayKey(new Date());
  let cursor = new Date();
  if (!days.has(today)) {
    const latest = entries
      .map((e) => new Date(e.createdAt))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!latest) return 0;
    cursor = latest;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
