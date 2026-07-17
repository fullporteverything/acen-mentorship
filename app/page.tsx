import dynamic from "next/dynamic";
import LoginCard from "@/components/LoginCard";

// Load Three.js only on client side (no SSR) to avoid server-side errors
const ThreeBackground = dynamic(() => import("@/components/ThreeBackground"), {
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
        background: "#0a0a0a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* 3D animated background */}
      <ThreeBackground />

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
