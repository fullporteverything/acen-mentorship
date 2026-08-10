import Link from "next/link";

export default function SupportPage() {
  return (
    <main className="support-page">
      <section className="support-card">
        <p className="support-kicker">Mentorship support</p>
        <h1>Need access help?</h1>
        <p>
          Message the mentorship administrator on Discord. Include your Discord
          username and ID, plus a short description of what happened.
        </p>
        <p>
          For a security appeal, explain what triggered the warning. Your saved
          lessons, homework, and progress remain attached to your Discord account.
        </p>
        <Link href="/" className="btn-discord support-return">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
