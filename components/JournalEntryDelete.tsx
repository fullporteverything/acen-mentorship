/* Touch visibility for .journal-delete lives in globals.css (@media hover:none). */
"use client";

import { useEffect, useRef, useState } from "react";

const RESET_MS = 4000;

/**
 * Two-step delete for a journal entry. The first click arms the button
 * ("Confirm?" in the danger tint) and only the second click submits the
 * server-action form, so a stray tap can't erase a day's writing. The armed
 * state disarms itself after ~4s — nothing stays dangerous while unattended.
 */
export default function JournalEntryDelete({
  entryId,
  onDelete,
}: {
  entryId: string;
  onDelete: (formData: FormData) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), RESET_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed]);

  return (
    <form
      action={onDelete}
      className="journal-delete"
      onSubmit={(e) => {
        if (!armed) {
          // First click only arms it — the entry survives.
          e.preventDefault();
          setArmed(true);
        }
      }}
    >
      <input type="hidden" name="id" value={entryId} />
      <button
        type="submit"
        aria-label={armed ? "Confirm delete entry" : "Delete entry"}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "Georgia, serif",
          fontSize: 8,
          textTransform: "uppercase",
          padding: 0,
          color: armed ? "#E8807A" : undefined,
        }}
      >
        {armed ? "Confirm?" : "Delete"}
      </button>
    </form>
  );
}
