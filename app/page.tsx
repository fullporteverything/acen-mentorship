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
        background: "#EADAC0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Drifting kanji background */}
      <KanjiBackground />

      {/* Fixed vertical brand text — left side */}
      <div className="brand-vertical">
        Dojo&nbsp;&nbsp;Mentorship
      </div>

      {/* Center login card */}
      <LoginCard />
    </main>
  );
}
