import { SUPPLEMENTAL_GATE_CORE_POSITION } from "./lessons-config";

/**
 * Member rank shown as a gold pill in the top nav. Derived purely from the
 * viewer's curriculum progress — no I/O, never throws. The ladder mirrors the
 * "High-Roller Noir" theme:
 *
 *   The House    — administrators (they run the room, not a rank on the ladder)
 *   Checked In   — no core floors cleared yet
 *   On the Floor — at least one core floor cleared, but the CORE Floor 04 gate
 *                  is not yet passed
 *   High Roller  — past the Floor 04 gate, core curriculum not yet finished
 *   VIP          — full CORE curriculum complete
 *   Whale        — every floor (core + supplemental) complete
 */
export type Rank =
  | "The House"
  | "Checked In"
  | "On the Floor"
  | "High Roller"
  | "VIP"
  | "Whale";

export interface RankProgress {
  /** Administrators outrank the ladder entirely. */
  isAdmin?: boolean;
  /** CORE lesson states in curriculum order (from computeCurriculumStates). */
  coreStates?: readonly { completed?: boolean }[];
  /** All lesson states, core + supplemental (from computeCurriculumStates). */
  allStates?: readonly { completed?: boolean }[];
}

/**
 * Pure rank derivation. Defensive by construction: any missing/malformed input
 * falls back to "Checked In" rather than throwing, so a caller can render the
 * result without guarding.
 */
export function deriveRank(progress: RankProgress): Rank {
  try {
    if (progress?.isAdmin) return "The House";

    const coreStates = Array.isArray(progress?.coreStates)
      ? progress.coreStates
      : [];
    const allStates = Array.isArray(progress?.allStates)
      ? progress.allStates
      : [];

    const coreCompleted = coreStates.filter((s) => s?.completed).length;
    if (coreCompleted === 0) return "Checked In";

    // The CORE Floor 04 gate — the same position supplemental content unlocks on.
    const gateCleared = Boolean(
      coreStates[SUPPLEMENTAL_GATE_CORE_POSITION - 1]?.completed
    );
    if (!gateCleared) return "On the Floor";

    const fullCoreComplete =
      coreStates.length > 0 && coreCompleted >= coreStates.length;
    if (!fullCoreComplete) return "High Roller";

    const everythingComplete =
      allStates.length > 0 && allStates.every((s) => s?.completed);
    if (everythingComplete) return "Whale";

    return "VIP";
  } catch {
    return "Checked In";
  }
}
