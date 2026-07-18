import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import CloudflarePlayer from "@/components/CloudflarePlayer";

// A placeholder Cloudflare Stream video id for the demo player.
// Replace with a real Stream UID (or wire up per-lesson ids) when content lands.
const DEMO_VIDEO_ID =
  process.env.DEMO_STREAM_VIDEO_ID || "31c9291ab41fac05471db4e73aa11717";

export default async function LessonsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="scrollable" style={{ background: "#EADAC0" }}>
      <Sidebar active="/dashboard/lessons" />

      <main
        style={{
          marginLeft: "220px",
          padding: "60px 56px",
          minHeight: "100vh",
          position: "relative",
        }}
      >
        {/* Kanji corner accent — top right */}
        <div
          style={{
            position: "absolute",
            top: "24px",
            right: "40px",
            fontSize: "64px",
            color: "rgba(196,24,24,0.07)",
            fontFamily: "serif",
            userSelect: "none",
            lineHeight: 1,
          }}
        >
          修
        </div>

        {/* Header */}
        <div
          style={{
            borderBottom: "1px solid rgba(196,24,24,0.15)",
            paddingBottom: "32px",
            marginBottom: "48px",
          }}
        >
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "4px",
              color: "#C41818",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: "10px",
            }}
          >
            Lessons
          </p>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 400,
              letterSpacing: "4px",
              color: "#F0EDE6",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
            }}
          >
            The Curriculum
          </h1>
        </div>

        {/* Player */}
        <div style={{ maxWidth: "820px" }}>
          <p
            style={{
              fontSize: "9px",
              letterSpacing: "4px",
              color: "rgba(196,24,24,0.6)",
              textTransform: "uppercase",
              fontFamily: "Georgia, serif",
              marginBottom: "16px",
            }}
          >
            Lesson 01 — Foundations
          </p>

          <CloudflarePlayer videoId={DEMO_VIDEO_ID} title="Lesson 01 — Foundations" />

          <p
            style={{
              fontSize: "13px",
              color: "rgba(240,237,230,0.55)",
              fontFamily: "Georgia, serif",
              lineHeight: "1.9",
              fontStyle: "italic",
              marginTop: "24px",
            }}
          >
            Protected content. This stream is DRM-secured and tied to your
            membership. Sharing, recording, or redistributing is monitored.
          </p>

          <div
            style={{
              width: "32px",
              height: "1px",
              background: "linear-gradient(90deg, #C41818, transparent)",
              marginTop: "24px",
            }}
          />
        </div>

        {/* Kanji footer accent */}
        <div
          style={{
            marginTop: "64px",
            fontSize: "13px",
            color: "rgba(196,24,24,0.18)",
            fontFamily: "serif",
            letterSpacing: "12px",
            userSelect: "none",
          }}
        >
          道剣心武礼修練気
        </div>
      </main>
    </div>
  );
}
