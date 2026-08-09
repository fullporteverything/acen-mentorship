"use client";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <main className="dashboard-state-page">
      <p>THE DOJO</p>
      <h1>Something interrupted the page</h1>
      <span>Your progress is safe. Try loading this section again.</span>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
