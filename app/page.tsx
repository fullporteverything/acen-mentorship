import dynamic from "next/dynamic";
import LoginCard from "@/components/LoginCard";

// Load kanji background only on client side (no SSR)
const KanjiBackground = dynamic(() => import("@/components/ThreeBackground"), {
  ssr: false,
});

export default function LoginPage() {
  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#0D0505",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Drifting kanji background */}
      <KanjiBackground />

      {/* Fixed vertical brand text — left side */}
      <div className="brand-vertical">
        Acen&nbsp;&nbsp;Mentorship
      </div>

      {/* Version tag — bottom right */}
      <div className="version-tag">Acen V1</div>

      {/* Center login card */}
      <LoginCard />
    </main>
  );
}
