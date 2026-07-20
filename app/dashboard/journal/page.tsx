import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import TopNav from "@/components/TopNav";
import JournalComposer from "@/components/JournalComposer";
import MentorMode from "@/components/MentorMode";
import MarkFeedbackSeen from "@/components/MarkFeedbackSeen";
import JournalHeatmap from "@/components/JournalHeatmap";
import StreakPill from "@/components/StreakPill";
import {
  getJournal,
  saveJournal,
  uploadJournalImage,
  type JournalEntry,
} from "@/lib/journal-store";

export const dynamic = "force-dynamic";

const MAX_ENTRY = 5000;

/**
 * Journal — layout mirrors the reference (houseofapostles):
 *   Header    ← "My Journal" serif + small-caps subtitle with rule
 *   Streak    ← 🔥 X day streak pill, top-right of the header
 *   Composer  ← single textarea + live n/5000 + Post Entry button
 *   Entries   ← minimal cards: timestamp + body (delete on hover)
 *
 * Sizing runs ~20% tighter than the reference, and the ambient drifting-Φ
 * backdrop has been removed for a clean black background.
 */
export default async function JournalPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const discordId = session.user.discordId || session.user.id || "unknown";
  const isAdmin =
    !!process.env.ADMIN_DISCORD_ID &&
    session.user.discordId === process.env.ADMIN_DISCORD_ID;
  const entries = await getJournal(discordId);

  async function createEntry(formData: FormData): Promise<{ failedImages: number }> {
    "use server";
    const s = await auth();
    if (!s?.user) return { failedImages: 0 };
    const uid = s.user.discordId || s.user.id || "unknown";

    const body = String(formData.get("body") ?? "").trim().slice(0, MAX_ENTRY);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Upload up to 4 trade screenshots (stored private; shown via /api/blob).
    const files = formData
      .getAll("images")
      .filter((f): f is File => f instanceof File && f.size > 0);
    const images: string[] = [];
    let failedImages = 0;
    for (const file of files.slice(0, 4)) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 8 * 1024 * 1024) continue;
      try {
        images.push(
          await uploadJournalImage(uid, id, file.name || "screenshot.png", file)
        );
      } catch {
        // Skip a failed image rather than losing the whole entry.
        failedImages += 1;
      }
    }

    if (!body && images.length === 0) return { failedImages: 0 };

    const entry: JournalEntry = {
      id,
      title: "",
      body,
      mood: "",
      createdAt: new Date().toISOString(),
      discordUsername: s.user.name || undefined,
      images: images.length ? images : undefined,
    };

    const current = await getJournal(uid);
    await saveJournal(uid, [entry, ...current]);
    revalidatePath("/dashboard/journal");
    return { failedImages };
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

      <MentorMode isAdmin={isAdmin} />
      <MarkFeedbackSeen />

      <main
        className="dash-main"
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 76,
          padding: "56px 32px 76px",
          minHeight: "calc(100vh - 76px)",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {/* Header row: title/subtitle left, streak card right */}
          <header
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 20,
              marginBottom: 32,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <h1
                style={{
                  fontFamily: "'Cormorant Garamond', Georgia, serif",
                  fontSize: 34,
                  fontWeight: 500,
                  letterSpacing: 1,
                  color: "#E8A0A0",
                  marginBottom: 11,
                }}
              >
                My Journal
              </h1>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: 38,
                    height: 1,
                    background: "rgba(232,160,160,0.55)",
                  }}
                />
                <p
                  style={{
                    fontSize: 9,
                    letterSpacing: 3,
                    color: "rgba(245,240,240,0.7)",
                    textTransform: "uppercase",
                    fontFamily: "Georgia, serif",
                  }}
                >
                  Private journal between you and your mentor
                </p>
              </div>
            </div>

            <StreakPill dates={entries.map((e) => e.createdAt)} />
          </header>

          {entries.length > 0 ? (
            <section style={{ marginBottom: 40 }}>
              <p
                style={{
                  fontSize: 9,
                  letterSpacing: 3,
                  color: "rgba(232,160,160,0.6)",
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                  marginBottom: 12,
                }}
              >
                Consistency · last 13 weeks
              </p>
              <JournalHeatmap dates={entries.map((e) => e.createdAt)} />
            </section>
          ) : null}

          {/* Composer */}
          <section style={{ marginBottom: 51 }}>
            <JournalComposer action={createEntry} />
          </section>

          {/* Entries */}
          <section>
            {entries.length === 0 ? (
              <div
                style={{
                  border: "1px dashed rgba(232,160,160,0.18)",
                  padding: "35px 22px",
                  textAlign: "center",
                  color: "rgba(245,240,240,0.4)",
                  fontFamily: "Georgia, serif",
                  fontStyle: "italic",
                  fontSize: 11,
                }}
              >
                No entries yet. Your first post starts the streak.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
        padding: "16px 19px 18px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 11,
        }}
      >
        <span
          style={{
            fontSize: 9,
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
              cursor: "pointer",
              fontFamily: "Georgia, serif",
              fontSize: 8,
              textTransform: "uppercase",
              padding: 0,
            }}
          >
            Delete
          </button>
        </form>
      </header>

      {entry.body ? (
        <p
          style={{
            fontSize: 12,
            color: "rgba(245,240,240,0.9)",
            fontFamily: "Georgia, serif",
            lineHeight: 1.9,
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
          }}
        >
          {entry.body}
        </p>
      ) : null}

      {entry.images && entry.images.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: entry.body ? 12 : 0,
          }}
        >
          {entry.images.map((p) => (
            <a
              key={p}
              href={`/api/blob/${p}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                width: 132,
                height: 96,
                border: "1px solid rgba(232,160,160,0.15)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/blob/${p}`}
                alt="trade screenshot"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </a>
          ))}
        </div>
      ) : null}

      {entry.feedback ? (
        <div
          style={{
            marginTop: 16,
            paddingLeft: 14,
            borderLeft: "2px solid #E8A0A0",
          }}
        >
          <p
            style={{
              fontSize: 9,
              letterSpacing: 3,
              color: "#E8A0A0",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: 6,
            }}
          >
            Mentor feedback
          </p>
          <p
            style={{
              fontSize: 12,
              color: "rgba(245,240,240,0.85)",
              fontFamily: "Georgia, serif",
              lineHeight: 1.8,
              fontStyle: "italic",
              whiteSpace: "pre-wrap",
              wordWrap: "break-word",
            }}
          >
            {entry.feedback}
          </p>
        </div>
      ) : null}
    </article>
  );
}
