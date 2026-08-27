import LoginCard from "@/components/LoginCard";
import KanjiBackground from "@/components/ThreeBackground";
import { signOut } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawError = params.error;
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;
  // Signed, five-minute, account-bound proof that Discord just authenticated
  // this visitor — the only thing that authorises the "sign out everywhere"
  // button on a page shown to somebody who is not signed in.
  const rawReset = params.reset;
  const resetToken = Array.isArray(rawReset) ? rawReset[0] : rawReset;

  // CrackedGate's "Try Again". A visitor who reaches /?error=… while still
  // holding a session would otherwise loop: "/" → middleware bounce →
  // /dashboard → auth failure → back here. Signing out first gives them a
  // genuinely fresh attempt (and is a harmless redirect when logged out).
  async function signOutAndRetry() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

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
      {/* Falling chips + cards — the real Blender renders */}
      <KanjiBackground variant="deck" />

      {/* Fixed vertical brand text — left side */}
      <div className="brand-vertical">
        Suite 7&nbsp;&nbsp;Mentorship
      </div>

      {/* Center login card (also renders CrackedGate overlay when errorCode is present) */}
      <LoginCard
        errorCode={errorCode}
        resetToken={resetToken}
        signOutAction={signOutAndRetry}
      />
    </main>
  );
}
