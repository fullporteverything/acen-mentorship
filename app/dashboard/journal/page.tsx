import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Sidebar from "@/components/Sidebar";
import { getJournal, saveJournal, type JournalEntry } from "@/lib/journal-store";

export const dynamic = "force-dynamic";

/**
 * Journal — per-user reflection ledger. Mirrors the dojo look (kanji corner
 * accent, burgundy rules, serif) and the composer/list pattern from the
 * lessons page. Data is Vercel-Blob backed via lib/journal-store.
 */
export default async function JournalPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const discordId =
    session.user.discordId || session.user.id || "unknown";
  const entries = await getJournal(discordId);

  async function createEntry(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user) return;
    const uid = s.user.discordId || s.user.id || "unknown";

    const title = String(formData.get("title") ?? "").trim().slice(0, 200);
    const body = String(formData.get("body") ?? "").trim().slice(0, 10000);
    const mood = String(formData.get("mood") ?? "").trim().slice(0, 40);
    if (!body) return;

    const entry: JournalEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: title || "Untitled",
      body,
      mood,
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
    await saveJournal(
      uid,
      current.filter((e) => e.id !== id)
    );
    revalidatePath("/dashboard/journal");
  }

  return (
    <div className="scrollable" style={{ background: "#000000" }}>
      <Sidebar active="/dashboard/journal" />

      <main
        style={{
          marginLeft: "220px",
          padding: "60px 56px",
          minHeight: "100vh",
          position: "relative",
        }}
      >
        {/* Kanji corner accent — 念 (thought / mindfulness) */}
        <div
          style={{
            position: "absolute",
            top: 24,
            right: 40,
            fontSize: 64,
            color: "rgba(232,160,160,0.07)",
            fontFamily: "serif",
            userSelect: "none",
            lineHeight: 1,
          }}
        >
          念
        </div>

        {/* Header */}
        <div
          style={{
            borderBottom: "1px solid rgba(232,160,160,0.15)",
            paddingBottom: 32,
            marginBottom: 40,
          }}
        >
          <p
            style={{
              fontSize: 10,
              letterSpacing: 4,
              color: "#E8A0A0",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: 10,
            }}
          >
            Journal
          </p>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 400,
              letterSpacing: 4,
              color: "#F5F0F0",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            The Ledger
          </h1>
          <p
            style={{
              marginTop: 14,
              fontSize: 13,
              color: "rgba(245,240,240,0.55)",
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              maxWidth: 560,
              lineHeight: 1.8,
            }}
          >
            Reflections, reads, discipline. What you write here stays private to
            your account.
          </p>
        </div>

        {/* Composer */}
        <section style={{ maxWidth: 760, marginBottom: 56 }}>
          <p
            style={{
              fontSize: 9,
              letterSpacing: 4,
              color: "rgba(232,160,160,0.6)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: 16,
            }}
          >
            New Entry
          </p>

          <form
            action={createEntry}
            style={{
              border: "1px solid rgba(232,160,160,0.12)",
              background: "rgba(232,160,160,0.02)",
              padding: "24px 26px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <input
              name="title"
              placeholder="Title"
              maxLength={200}
              style={inputStyle}
            />
            <textarea
              name="body"
              placeholder="What did you see today?"
              rows={7}
              maxLength={10000}
              required
              style={{ ...inputStyle, resize: "vertical", minHeight: 140 }}
            />
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <input
                name="mood"
                placeholder="Tag / mood (e.g. sharp, hesitant, waiting)"
                maxLength={40}
                style={{ ...inputStyle, maxWidth: 320 }}
              />
              <button type="submit" className="btn-discord" style={{ padding: "12px 28px" }}>
                Inscribe
              </button>
            </div>
          </form>
        </section>

        {/* Entries */}
        <section style={{ maxWidth: 760 }}>
          <p
            style={{
              fontSize: 9,
              letterSpacing: 4,
              color: "rgba(232,160,160,0.6)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: 20,
            }}
          >
            Entries · {entries.length}
          </p>

          {entries.length === 0 ? (
            <div
              style={{
                border: "1px dashed rgba(232,160,160,0.18)",
                padding: "40px 28px",
                textAlign: "center",
                color: "rgba(245,240,240,0.4)",
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: 13,
              }}
            >
              The ledger is empty. First inscription writes it into being.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {entries.map((e) => (
                <JournalCard key={e.id} entry={e} onDelete={deleteEntry} />
              ))}
            </div>
          )}
        </section>

        {/* Kanji footer accent */}
        <div
          style={{
            marginTop: 72,
            fontSize: 13,
            color: "rgba(232,160,160,0.18)",
            fontFamily: "serif",
            letterSpacing: 12,
            userSelect: "none",
          }}
        >
          念記省心律
        </div>
      </main>
    </div>
  );
}

function JournalCard({
  entry,
  onDelete,
}: {
  entry: JournalEntry;
  onDelete: (formData: FormData) => Promise<void>;
}) {
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article
      style={{
        position: "relative",
        border: "1px solid rgba(232,160,160,0.12)",
        background: "rgba(232,160,160,0.03)",
        padding: "24px 26px 22px",
        overflow: "hidden",
      }}
    >
      {/* Left rule — subtle burgundy stripe like an announcement */}
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background:
            "linear-gradient(180deg, rgba(232,160,160,0.7), rgba(232,160,160,0.05))",
        }}
      />

      {/* Date + mood row */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: 3,
              color: "#E8A0A0",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            {dateStr}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "rgba(245,240,240,0.35)",
              fontFamily: "Georgia, serif",
              letterSpacing: 2,
            }}
          >
            {timeStr}
          </span>
          {entry.mood && (
            <span
              style={{
                fontSize: 10,
                letterSpacing: 2,
                color: "rgba(232,160,160,0.8)",
                textTransform: "uppercase",
                fontFamily: "Georgia, serif",
                border: "1px solid rgba(232,160,160,0.3)",
                padding: "2px 8px",
              }}
            >
              {entry.mood}
            </span>
          )}
        </div>

        <form action={onDelete}>
          <input type="hidden" name="id" value={entry.id} />
          <button
            type="submit"
            aria-label="Delete entry"
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(232,160,160,0.35)",
              cursor: "pointer",
              fontFamily: "Georgia, serif",
              fontSize: 10,
              letterSpacing: 3,
              textTransform: "uppercase",
              padding: 0,
            }}
          >
            Burn
          </button>
        </form>
      </header>

      <h3
        style={{
          fontSize: 18,
          fontWeight: 400,
          color: "#F5F0F0",
          fontFamily: "Georgia, serif",
          letterSpacing: 1.5,
          marginBottom: 10,
        }}
      >
        {entry.title}
      </h3>

      <p
        style={{
          fontSize: 14,
          color: "rgba(245,240,240,0.78)",
          fontFamily: "Georgia, serif",
          lineHeight: 1.9,
          whiteSpace: "pre-wrap",
        }}
      >
        {entry.body}
      </p>

      <div
        style={{
          marginTop: 20,
          width: 32,
          height: 1,
          background: "linear-gradient(90deg, #E8A0A0, transparent)",
        }}
      />
    </article>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(0,0,0,0.5)",
  border: "1px solid rgba(232,160,160,0.18)",
  color: "#F5F0F0",
  fontFamily: "Georgia, serif",
  fontSize: 14,
  padding: "12px 14px",
  outline: "none",
  letterSpacing: 0.5,
};
