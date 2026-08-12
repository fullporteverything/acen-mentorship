import LoginCard from "@/components/LoginCard";
import KanjiBackground from "@/components/ThreeBackground";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawError = params.error;
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;

  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Drifting sakura background */}
      <KanjiBackground />

      {/* Fixed vertical brand text — left side */}
      <div className="brand-vertical">
        Dojo&nbsp;&nbsp;Mentorship
      </div>

      {/* Center login card (also renders CrackedGate overlay when errorCode is present) */}
      <LoginCard errorCode={errorCode} />
    </main>
  );
}
