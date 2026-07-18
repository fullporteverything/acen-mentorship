/**
 * In-memory security store shared across the security + admin API routes.
 *
 * NOTE: this is process-local. On serverless/multi-instance deploys each
 * instance keeps its own copy — fine for the current "best-effort deterrent"
 * scope. Backed by `globalThis` so state survives Next.js dev HMR reloads.
 */

export interface CaptureLog {
  discordId?: string;
  discordUsername?: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
}

interface SecurityState {
  captureLogs: CaptureLog[];
  /** When false, the client-side screen lock should be released. */
  lockActive: boolean;
}

const globalStore = globalThis as unknown as {
  __dojoSecurityState?: SecurityState;
};

const state: SecurityState =
  globalStore.__dojoSecurityState ??
  (globalStore.__dojoSecurityState = {
    captureLogs: [],
    lockActive: true,
  });

export function addCaptureLog(entry: CaptureLog): CaptureLog {
  state.captureLogs.push(entry);
  // Keep the list bounded so a spammy client can't grow it unbounded.
  if (state.captureLogs.length > 500) {
    state.captureLogs.splice(0, state.captureLogs.length - 500);
  }
  return entry;
}

export function getCaptureLogs(): CaptureLog[] {
  // Newest first for the admin panel.
  return [...state.captureLogs].reverse();
}

export function clearLocks(): void {
  state.lockActive = false;
}

export function isLockActive(): boolean {
  return state.lockActive;
}
