"use client";

export default function RetryButton({
  onRetry,
  label = "Retry",
}: {
  onRetry: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="state-retry"
      onClick={onRetry}
    >
      {label}
    </button>
  );
}
