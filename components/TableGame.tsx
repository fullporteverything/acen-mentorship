"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import TableScene from "@/components/TableScene";
import { tableAudio } from "@/lib/table-audio";
import {
  RESHUFFLE_BELOW,
  buildShoe,
  dealerShouldHit,
  handValue,
  isBlackjack,
  settle,
  shuffle,
  type Card,
  type Settlement,
} from "@/lib/blackjack";
import {
  fetchChipState,
  postSettle,
  type ChipStats,
  type NewGrant,
} from "@/lib/table-chips-client";
import ChipLeaderboard from "@/components/ChipLeaderboard";

/**
 * The Table — house blackjack, play-chips only. No purchases, no cash-out.
 *
 * The bankroll is SERVER-HELD (lib/table-chips-store): it follows the member
 * across devices, feeds the leaderboard, and is earned from real course
 * progress. Settlement is authoritative on the server — this component shows
 * the local result immediately for feel, then reconciles with the balance the
 * server returns. If the API is unreachable the table stays playable offline
 * against the localStorage cache, and simply stops reporting hands.
 *
 * All RULES live in lib/blackjack.ts; this component owns the phase state
 * machine and rendering. Round flow:
 *
 *   BETTING → PLAYER → DEALER (timed draws) → SETTLED → next hand
 *
 * Guard model: `phaseRef`/hand refs are updated SYNCHRONOUSLY inside the
 * transition helpers, so a double-click or a stray keypress between React
 * renders can never act twice — every handler checks phaseRef first.
 *
 * TODO(v2): splits. settle() already takes explicit hands, so a split is a
 * second player hand + a per-hand settle loop here.
 */

type Phase = "BETTING" | "PLAYER" | "DEALER" | "SETTLED";

const CHIPS_KEY = "suite7:chips";
const DEFAULT_CHIPS = 1000;
const STAKE_AMOUNT = 500;
const MIN_BET = 25;
const CHIP_DENOMS = [25, 100, 500] as const;
const STEP_MS = 600;

const SUIT_NAMES: Record<Card["suit"], string> = {
  "♠": "spades",
  "♥": "hearts",
  "♦": "diamonds",
  "♣": "clubs",
};

const GOLD = "#e3c071";
const CREAM = "#F5F0F0";
const CRIMSON = "#b21d3b";

/** The printed felt rules moved into the DOM (the felt print is hidden in 3D). */
const HOUSE_RULES = [
  "Blackjack pays 3 to 2",
  "Dealer stands on all 17s",
  "Double on first two cards",
  "6-deck shoe",
] as const;

function formatChips(n: number): string {
  // 3:2 on a 25 bet pays 37.5 — show the half-chip rather than lying.
  return n % 1 === 0 ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export default function TableGame() {
  // Rendered state (mirrors of the refs below where noted).
  const [phase, setPhase] = useState<Phase>("BETTING");
  const [bankroll, setBankroll] = useState<number | null>(null); // null until localStorage loads
  const [bet, setBet] = useState(0);
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [dealerHand, setDealerHand] = useState<Card[]>([]);
  const [holeRevealed, setHoleRevealed] = useState(false);
  const [doubled, setDoubled] = useState(false);
  const [stats, setStats] = useState<ChipStats | null>(null);
  const [grants, setGrants] = useState<NewGrant[]>([]);
  const [result, setResult] = useState<Settlement | null>(null);
  const [shuffleNote, setShuffleNote] = useState(false);
  // 3D scene support: reduced motion snaps the scene's animations; only a
  // WebGL init failure drops back to the DOM card rows.
  const [reducedMotion, setReducedMotion] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  // Table dressing: mute toggle + the house-rules panel. Neither touches play.
  const [muted, setMuted] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rollersOpen, setRollersOpen] = useState(false);
  /** Bumped on every reshuffle so the scene can play ShoeRefill + `shuffle`. */
  const [shuffleSeq, setShuffleSeq] = useState(0);

  // Synchronous truth for guards + timer callbacks (state lags a render).
  const phaseRef = useRef<Phase>("BETTING");
  const bankrollRef = useRef<number | null>(null);
  const stakeRef = useRef(0);
  /** The BASE stake, unchanged by a double — the server wants stake + flag. */
  const baseStakeRef = useRef(0);
  /** False once a server call fails: the table keeps playing, offline. */
  const onlineRef = useRef(true);
  const pHandRef = useRef<Card[]>([]);
  const dHandRef = useRef<Card[]>([]);
  const shoeRef = useRef<Card[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reducedRef = useRef(false);

  const toPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);
  const setPlayer = useCallback((h: Card[]) => {
    pHandRef.current = h;
    setPlayerHand(h);
  }, []);
  const setDealer = useCallback((h: Card[]) => {
    dHandRef.current = h;
    setDealerHand(h);
  }, []);
  const setChips = useCallback((n: number) => {
    bankrollRef.current = n;
    setBankroll(n);
    try {
      window.localStorage.setItem(CHIPS_KEY, String(n));
    } catch {
      // Private mode etc. — the game still plays, chips just don't persist.
    }
  }, []);

  // Load the bankroll after mount (SSR-safe: render "—" until then). The
  // server is the source of truth; opening the table also claims whatever the
  // member has earned since last time, which we surface as a toast.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await fetchChipState();
        if (cancelled) return;
        bankrollRef.current = state.balance;
        setBankroll(state.balance);
        setStats(state.stats);
        if (state.newGrants.length > 0) setGrants(state.newGrants);
        try {
          window.localStorage.setItem(CHIPS_KEY, String(state.balance));
        } catch {
          // cache only
        }
      } catch {
        // Offline / API down: fall back to the cached stack so the table is
        // still playable. Hands won't be reported until the next reload.
        if (cancelled) return;
        onlineRef.current = false;
        let chips = DEFAULT_CHIPS;
        try {
          const raw = window.localStorage.getItem(CHIPS_KEY);
          if (raw !== null) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && parsed >= 0) chips = parsed;
          }
        } catch {
          // Fall through to the default stack.
        }
        bankrollRef.current = chips;
        setBankroll(chips);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // prefers-reduced-motion → all dealing delays collapse to zero.
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedRef.current = mq.matches;
      setReducedMotion(mq.matches);
      const onChange = () => {
        reducedRef.current = mq.matches;
        setReducedMotion(mq.matches);
      };
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      return undefined;
    }
  }, []);

  // Every timer is tracked and cleared on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.length = 0;
    };
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, reducedRef.current ? 0 : ms);
    timersRef.current.push(id);
  }, []);

  /** Refill the shoe. The seq bump is what cues ShoeRefill + the shuffle voice. */
  const reshuffle = useCallback(() => {
    shoeRef.current = shuffle(buildShoe());
    setShuffleSeq((n) => n + 1);
  }, []);

  const draw = useCallback((): Card => {
    if (shoeRef.current.length === 0) {
      // Can't happen with the between-rounds reshuffle, but never deal air.
      reshuffle();
    }
    return shoeRef.current.pop() as Card;
  }, [reshuffle]);

  /** Dealer's turn: flip the hole card, draw to 17+ (if wanted), settle. */
  const runDealer = useCallback(
    (dealerDraws: boolean) => {
      toPhase("DEALER");
      let t = STEP_MS;
      schedule(() => setHoleRevealed(true), t);
      t += STEP_MS;
      if (dealerDraws) {
        // Outcome is decided synchronously from the shoe; the timers only
        // animate the reveal, so a re-render can never change the result.
        const dealer = dHandRef.current.slice();
        while (dealerShouldHit(dealer)) {
          const card = draw();
          dealer.push(card);
          schedule(() => setDealer([...dHandRef.current, card]), t);
          t += STEP_MS;
        }
      }
      schedule(() => {
        const settlement = settle(stakeRef.current, pHandRef.current, dHandRef.current);
        setResult(settlement);
        // Optimistic: show the result instantly, then let the server's
        // authoritative balance land. A rejected or failed report leaves the
        // optimistic number in place rather than yanking the stack around.
        setChips((bankrollRef.current ?? DEFAULT_CHIPS) + settlement.delta);
        toPhase("SETTLED");
        if (onlineRef.current) {
          const wasDoubled = stakeRef.current > baseStakeRef.current;
          void postSettle({
            bet: baseStakeRef.current,
            playerHand: pHandRef.current,
            dealerHand: dHandRef.current,
            doubled: wasDoubled,
          })
            .then((res) => {
              bankrollRef.current = res.balance;
              setBankroll(res.balance);
              setStats(res.stats);
              try {
                window.localStorage.setItem(CHIPS_KEY, String(res.balance));
              } catch {
                // cache only
              }
            })
            .catch(() => {
              onlineRef.current = false;
            });
        }
      }, t);
    },
    [draw, schedule, setChips, setDealer, toPhase]
  );

  // ── BETTING ────────────────────────────────────────────────────────────
  const addChip = useCallback((value: number) => {
    if (phaseRef.current !== "BETTING") return;
    const chips = bankrollRef.current;
    if (chips === null) return;
    setBet((prev) => {
      const next = prev + value;
      if (next > chips) return prev; // can't bet more than the bankroll
      stakeRef.current = next;
      baseStakeRef.current = next;
      return next;
    });
  }, []);

  const clearBet = useCallback(() => {
    if (phaseRef.current !== "BETTING") return;
    stakeRef.current = 0;
    baseStakeRef.current = 0;
    setBet(0);
  }, []);

  const deal = useCallback(() => {
    if (phaseRef.current !== "BETTING") return;
    const chips = bankrollRef.current;
    const stake = stakeRef.current;
    if (chips === null || stake < MIN_BET || stake > chips) return;
    if (shoeRef.current.length < RESHUFFLE_BELOW) {
      reshuffle();
    }
    setShuffleNote(false);
    setResult(null);
    setDoubled(false);
    setHoleRevealed(false);
    const p1 = draw();
    const d1 = draw();
    const p2 = draw();
    const d2 = draw(); // hole card
    setPlayer([p1, p2]);
    setDealer([d1, d2]);
    if (isBlackjack([p1, p2]) || isBlackjack([d1, d2])) {
      // Dealer peeks after the deal: naturals resolve immediately (no draws).
      runDealer(false);
    } else {
      toPhase("PLAYER");
    }
  }, [draw, reshuffle, runDealer, setDealer, setPlayer, toPhase]);

  const takeStake = useCallback(() => {
    if (phaseRef.current !== "BETTING") return;
    const chips = bankrollRef.current;
    if (chips === null || chips >= MIN_BET) return;
    setChips(STAKE_AMOUNT);
  }, [setChips]);

  // ── PLAYER ─────────────────────────────────────────────────────────────
  const hit = useCallback(() => {
    if (phaseRef.current !== "PLAYER") return;
    const hand = [...pHandRef.current, draw()];
    setPlayer(hand);
    const { total } = handValue(hand);
    if (total > 21) runDealer(false); // busted — reveal, no dealer draws
    else if (total === 21) runDealer(true); // nothing left to decide
  }, [draw, runDealer, setPlayer]);

  const stand = useCallback(() => {
    if (phaseRef.current !== "PLAYER") return;
    runDealer(true);
  }, [runDealer]);

  const doubleDown = useCallback(() => {
    if (phaseRef.current !== "PLAYER") return;
    if (pHandRef.current.length !== 2) return; // first two cards only
    const chips = bankrollRef.current;
    const stake = stakeRef.current;
    if (chips === null || chips < stake * 2) return; // bankroll must cover it
    stakeRef.current = stake * 2;
    setBet(stakeRef.current);
    setDoubled(true);
    const hand = [...pHandRef.current, draw()];
    setPlayer(hand);
    runDealer(handValue(hand).total <= 21); // one card, then auto-stand
  }, [draw, runDealer, setPlayer]);

  // ── SETTLED ────────────────────────────────────────────────────────────
  const nextHand = useCallback(() => {
    if (phaseRef.current !== "SETTLED") return;
    setPlayer([]);
    setDealer([]);
    setResult(null);
    setHoleRevealed(false);
    setDoubled(false);
    stakeRef.current = 0;
    baseStakeRef.current = 0;
    setBet(0);
    if (shoeRef.current.length < RESHUFFLE_BELOW) {
      reshuffle();
      setShuffleNote(true);
    } else {
      setShuffleNote(false);
    }
    toPhase("BETTING");
  }, [reshuffle, setDealer, setPlayer, toPhase]);

  // Keyboard: H = hit, S = stand (PLAYER phase only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (phaseRef.current !== "PLAYER") return;
      const key = e.key.toLowerCase();
      if (key === "h") {
        e.preventDefault();
        hit();
      } else if (key === "s") {
        e.preventDefault();
        stand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hit, stand]);

  const handleGlFallback = useCallback(() => setWebglFailed(true), []);

  // ── Table audio (lib/table-audio.ts) ───────────────────────────────────
  // The scene fires the per-card / per-chip voices in sync with its own
  // animations; the outcome voices belong to the state machine.
  useEffect(() => {
    setMuted(tableAudio().isMuted());
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      tableAudio().setMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (phase !== "SETTLED" || !result) return;
    tableAudio().play(
      result.outcome === "lose" ? "lose" : result.outcome === "push" ? "push" : "win"
    );
  }, [phase, result]);

  // The audio graph is shared by the whole table — only the page tears it down.
  useEffect(() => () => tableAudio().dispose(), []);

  // ── Derived display values ─────────────────────────────────────────────
  const playerValue = playerHand.length ? handValue(playerHand) : null;
  const dealerValue = dealerHand.length ? handValue(dealerHand) : null;
  const canDouble =
    phase === "PLAYER" &&
    playerHand.length === 2 &&
    bankroll !== null &&
    bankroll >= bet * 2;
  const broke = phase === "BETTING" && bankroll !== null && bankroll < MIN_BET;

  const dealerTotalText =
    dealerHand.length === 0 ? "" : holeRevealed && dealerValue ? String(dealerValue.total) : "?";
  const playerTotalText = playerValue
    ? `${playerValue.total}${playerValue.soft ? " soft" : ""}`
    : "";

  // Center strip (result banner / dealer note) — shared by 3D and DOM paths.
  const centerStrip = (
    <div
      style={{
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "10px 0",
      }}
      aria-live="polite"
    >
      {phase === "SETTLED" && result ? <ResultBanner result={result} /> : null}
      {phase === "DEALER" ? (
        <span
          style={{
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 11,
            color: "rgba(245,240,240,0.45)",
          }}
        >
          {doubled ? `doubled to ${formatChips(bet)} — ` : ""}the dealer plays…
        </span>
      ) : null}
    </div>
  );

  // Screen-reader description of the 3D table (canvas pixels aren't readable).
  const describeHand = (hand: Card[], hiddenIndex: number) =>
    hand
      .map((card, i) =>
        i === hiddenIndex ? "a face-down card" : `${card.rank} of ${SUIT_NAMES[card.suit]}`
      )
      .join(", ");
  const sceneLabel = `Blackjack table. Dealer: ${
    dealerHand.length ? describeHand(dealerHand, holeRevealed ? -1 : 1) : "no cards"
  }. You: ${playerHand.length ? describeHand(playerHand, -1) : "no cards"}.`;

  /* The action cluster — the same buttons whether they float over the 3D
     stage or sit in flow under the DOM fallback. */
  const controls = (
    <>
      {phase === "BETTING" ? (
        <>
          <div
            className="suite7-denoms"
            role="group"
            aria-label="Chip denominations — or click the chips on the felt"
          >
            {CHIP_DENOMS.map((value) => (
              <button
                key={value}
                type="button"
                className="suite7-chip-btn"
                onClick={() => addChip(value)}
                disabled={bankroll === null || bet + value > bankroll}
                aria-label={`Add ${value} to bet`}
                style={{
                  background:
                    value === 500
                      ? `radial-gradient(circle at 35% 30%, #d4526f, ${CRIMSON} 55%, #5f0f20)`
                      : value === 100
                        ? "radial-gradient(circle at 35% 30%, #f7e8ac, #b8934a 65%, #6f5320)"
                        : "radial-gradient(circle at 35% 30%, #fdfaf0, #cfc4a8 65%, #8d8368)",
                  color: value === 500 ? CREAM : "#0a0805",
                }}
              >
                {value}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="suite7-btn suite7-btn-quiet"
            onClick={clearBet}
            disabled={bet === 0}
            aria-label={bet > 0 ? `Bet ${bet} — click to clear` : "No bet placed"}
            title={bet > 0 ? "Click to clear the bet" : undefined}
          >
            Bet {formatChips(bet)}
            {bet > 0 ? <span aria-hidden> ✕</span> : null}
          </button>

          <button
            type="button"
            className="suite7-btn suite7-btn-primary"
            onClick={deal}
            disabled={bankroll === null || bet < MIN_BET}
          >
            Deal
          </button>

          {broke ? (
            <button type="button" className="suite7-btn" onClick={takeStake}>
              The House stakes you.
            </button>
          ) : null}
        </>
      ) : null}

      {phase === "PLAYER" ? (
        <>
          <button type="button" className="suite7-btn suite7-btn-primary" onClick={hit}>
            Hit
          </button>
          <button type="button" className="suite7-btn" onClick={stand}>
            Stand
          </button>
          <button type="button" className="suite7-btn" onClick={doubleDown} disabled={!canDouble}>
            Double
          </button>
          <span className="suite7-keyhint">H — hit · S — stand</span>
        </>
      ) : null}

      {phase === "SETTLED" ? (
        <button type="button" className="suite7-btn suite7-btn-primary" onClick={nextHand}>
          Next hand
        </button>
      ) : null}
    </>
  );

  /* Bankroll + live bet, as a corner readout over the felt. */
  const bankReadout = (
    <div className="suite7-bank">
      <ChipStack bankroll={bankroll} />
      <div className="suite7-bank-figures">
        <span className="suite7-bank-label">Bankroll</span>
        <span className="suite7-bank-value">
          {bankroll === null ? "—" : formatChips(bankroll)}
        </span>
      </div>
      <div className="suite7-bank-figures suite7-bank-bet">
        <span className="suite7-bank-label">Bet</span>
        <span className="suite7-bank-value">{bet === 0 ? "—" : formatChips(bet)}</span>
      </div>
      {shuffleNote && phase === "BETTING" ? (
        <span className="suite7-bank-note">shuffling the shoe…</span>
      ) : null}
    </div>
  );

  const tools = (
    <div className="suite7-stage-tools">
      <button
        type="button"
        className="suite7-tool"
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? "Unmute table sound" : "Mute table sound"}
        title={muted ? "Sound off" : "Sound on"}
      >
        <SpeakerIcon muted={muted} />
      </button>
      <button
        type="button"
        className="suite7-tool suite7-tool-wide"
        data-suite7-panel-toggle="rules"
        onClick={() => {
          setRollersOpen(false);
          setRulesOpen((v) => !v);
        }}
        aria-expanded={rulesOpen}
        aria-controls="suite7-house-rules"
      >
        House Rules
      </button>
      <button
        type="button"
        className="suite7-tool suite7-tool-wide"
        data-suite7-panel-toggle="rollers"
        onClick={() => {
          setRulesOpen(false);
          setRollersOpen((v) => !v);
        }}
        aria-expanded={rollersOpen}
        aria-controls="suite7-high-rollers"
      >
        High Rollers
      </button>
    </div>
  );

  /* What the House just paid you for course progress since last visit. */
  const earnings =
    grants.length > 0 ? (
      <div className="suite7-grants" role="status">
        <div className="suite7-grants-head">
          <span>The House settles up</span>
          <button type="button" onClick={() => setGrants([])} aria-label="Dismiss earnings">
            ×
          </button>
        </div>
        {grants.map((g) => (
          <p key={g.grantKey}>
            <span>{g.label}</span>
            <span className="suite7-grants-amt">+{formatChips(g.amount)}</span>
          </p>
        ))}
      </div>
    ) : null;

  const panels = (
    <>
      {rulesOpen ? (
        <OverlayPanel
          id="suite7-house-rules"
          label="House rules"
          title="House Rules"
          toggle="rules"
          onClose={() => setRulesOpen(false)}
        >
          <ul className="suite7-rules-list">
            {HOUSE_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </OverlayPanel>
      ) : null}
      {rollersOpen ? (
        <OverlayPanel
          id="suite7-high-rollers"
          label="High rollers"
          title="High Rollers"
          toggle="rollers"
          wide
          onClose={() => setRollersOpen(false)}
        >
          <ChipLeaderboard />
        </OverlayPanel>
      ) : null}
    </>
  );

  // WebGL init failed: no stage, just the old DOM table in flow. Everything
  // still plays; it simply stops being a room and goes back to being a panel.
  if (webglFailed) {
    return (
      <div className="suite7-fallback">
        <section className="suite7-felt" aria-label="Blackjack table">
          {earnings}
          <div className="suite7-fallback-head">
            {bankReadout}
            {tools}
          </div>
          <DomCardTable
            playerHand={playerHand}
            dealerHand={dealerHand}
            holeRevealed={holeRevealed}
            dealerTotalText={dealerTotalText}
            playerTotalText={playerTotalText}
            centerStrip={centerStrip}
          />
          <div className="suite7-fallback-controls">{controls}</div>
          {panels}
        </section>
      </div>
    );
  }

  return (
    <div className="suite7-stage">
      {/* The room. role="img" wraps ONLY the canvas so every overlay control
          below stays reachable by assistive tech. */}
      <div className="suite7-stage-canvas" role="img" aria-label={sceneLabel}>
        <TableScene
          playerHand={playerHand}
          dealerHand={dealerHand}
          holeCardHidden={!holeRevealed}
          phase={phase}
          betChips={bet}
          bankroll={bankroll}
          shuffleSeq={shuffleSeq}
          outcome={result?.outcome ?? null}
          reducedMotion={reducedMotion}
          onPlaceBet={addChip}
          onClearBet={clearBet}
          onFallback={handleGlFallback}
        />
      </div>

      <div className="suite7-hud suite7-hud-bank">{bankReadout}</div>

      <div className="suite7-hud suite7-hud-dealer" aria-hidden>
        <HudTag label="Dealer" totalText={dealerTotalText} />
      </div>
      <div className="suite7-hud suite7-hud-player" aria-hidden>
        <HudTag label="You" totalText={playerTotalText} />
      </div>

      <div className="suite7-hud suite7-hud-tools">{tools}</div>
      {panels}

      <div className="suite7-hud suite7-stage-banner" aria-live="polite">
        {phase === "SETTLED" && result ? <ResultBanner result={result} /> : null}
        {phase === "DEALER" ? (
          <span className="suite7-scene-note">
            {doubled ? `doubled to ${formatChips(bet)} — ` : ""}the dealer plays…
          </span>
        ) : null}
      </div>

      {/* Nothing to act on while the dealer draws — the cluster gets out of
          the way rather than floating empty over the felt. */}
      {phase === "DEALER" ? null : (
        <div className="suite7-hud suite7-stage-controls">
          <div className="suite7-controls-scrim">{controls}</div>
        </div>
      )}

      {earnings ? <div className="suite7-hud suite7-hud-grants">{earnings}</div> : null}
    </div>
  );
}

/* ── Presentational pieces ─────────────────────────────────────────────── */

/** Gold speaker glyph for the mute toggle. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        d="M3 6h2.2L8.6 3.2v9.6L5.2 10H3z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {muted ? (
        <path d="M11 5.6l3.4 4.8M14.4 5.6L11 10.4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      ) : (
        <>
          <path d="M10.9 5.7a3.2 3.2 0 010 4.6" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <path d="M12.8 3.9a5.8 5.8 0 010 8.2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * A floating panel over the stage — the house rules (which used to be printed
 * on the felt; the 3D scene hides the `S7_FeltPrint` material) and the high-
 * roller board. Dismisses on Esc and on a click outside; its own toggle button
 * is excluded so a second click just closes it.
 */
function OverlayPanel({
  id,
  label,
  title,
  toggle,
  wide,
  onClose,
  children,
}: {
  id: string;
  label: string;
  title: string;
  /** Value of the data-suite7-panel-toggle attribute on this panel's button. */
  toggle: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (target.closest(`[data-suite7-panel-toggle="${toggle}"]`)) return; // its own toggle
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, toggle]);

  return (
    <div
      id={id}
      ref={ref}
      className={`suite7-panel-pop${wide ? " suite7-panel-wide" : ""}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
    >
      <div className="suite7-rules-title">{title}</div>
      <div className="suite7-panel-body">{children}</div>
      <button type="button" className="suite7-rules-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/** Label + total pill overlaid on the 3D scene — gold hairline, blurred glass. */
function HudTag({ label, totalText }: { label: string; totalText: string }) {
  return (
    <div className="suite7-hud-pill">
      <span className="suite7-hud-label">{label}</span>
      {totalText ? <span className="suite7-hud-total">{totalText}</span> : null}
    </div>
  );
}

/**
 * FALLBACK path: the original DOM-rendered card rows, used only when WebGL
 * init fails (TableScene calls onFallback). Kept intact so the game never
 * loses its table.
 */
function DomCardTable({
  playerHand,
  dealerHand,
  holeRevealed,
  dealerTotalText,
  playerTotalText,
  centerStrip,
}: {
  playerHand: Card[];
  dealerHand: Card[];
  holeRevealed: boolean;
  dealerTotalText: string;
  playerTotalText: string;
  centerStrip: ReactNode;
}) {
  return (
    <>
      <HandRow
        label="Dealer"
        hand={dealerHand}
        holeIndex={1}
        holeRevealed={holeRevealed}
        totalText={dealerTotalText}
      />
      {centerStrip}
      <HandRow
        label="You"
        hand={playerHand}
        holeIndex={-1}
        holeRevealed
        totalText={playerTotalText}
      />
    </>
  );
}

function ResultBanner({ result }: { result: Settlement }) {
  let text: string;
  let color: string;
  switch (result.outcome) {
    case "blackjack":
      text = `Blackjack — you win +${formatChips(result.delta)}`;
      color = GOLD;
      break;
    case "win":
      text = `You win +${formatChips(result.delta)}`;
      color = GOLD;
      break;
    case "push":
      text = "Push";
      color = CREAM;
      break;
    default:
      text = "House takes it";
      color = "rgba(245,240,240,0.45)";
  }
  return (
    <span
      style={{
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        fontSize: 22,
        letterSpacing: 1.5,
        color,
        fontVariantNumeric: "tabular-nums",
        textShadow: "0 2px 14px rgba(0,0,0,0.95), 0 0 30px rgba(0,0,0,0.7)",
      }}
    >
      {text}
    </span>
  );
}

function HandRow({
  label,
  hand,
  holeIndex,
  holeRevealed,
  totalText,
}: {
  label: string;
  hand: Card[];
  /** Index of the face-down card (−1 for none). */
  holeIndex: number;
  holeRevealed: boolean;
  totalText: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: 3,
            textTransform: "uppercase",
            fontFamily: "Georgia, serif",
            color: "rgba(231,192,113,0.6)",
          }}
        >
          {label}
        </span>
        {totalText ? (
          <span
            style={{
              fontFamily: "Georgia, serif",
              fontVariantNumeric: "tabular-nums",
              fontSize: 12,
              color: "rgba(245,240,240,0.75)",
              border: "1px solid rgba(231,192,113,0.2)",
              padding: "1px 8px",
              borderRadius: 999,
            }}
            aria-label={`${label} total: ${totalText}`}
          >
            {totalText}
          </span>
        ) : null}
      </div>
      <div className="suite7-hand">
        {hand.map((card, i) =>
          i === holeIndex ? (
            <HoleCard key={`hole-${i}`} card={card} revealed={holeRevealed} dealDelayMs={i * 120} />
          ) : (
            <div
              key={`${i}-${card.rank}${card.suit}`}
              className="suite7-dealt"
              style={{ animationDelay: `${i < 2 ? i * 120 : 0}ms` }}
            >
              <CardFace card={card} />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CardFace({ card }: { card: Card }) {
  const red = card.suit === "♥" || card.suit === "♦";
  const color = red ? CRIMSON : GOLD;
  return (
    <div className="suite7-card" role="img" aria-label={`${card.rank} of ${SUIT_NAMES[card.suit]}`}>
      <span className="suite7-card-corner" aria-hidden style={{ color }}>
        <span>{card.rank}</span>
        <span>{card.suit}</span>
      </span>
      <span className="suite7-card-center" aria-hidden style={{ color }}>
        {card.suit}
      </span>
      <span className="suite7-card-corner suite7-card-corner-br" aria-hidden style={{ color }}>
        <span>{card.rank}</span>
        <span>{card.suit}</span>
      </span>
    </div>
  );
}

/** Dealer's hole card: face-down back that rotateY-flips on reveal. */
function HoleCard({
  card,
  revealed,
  dealDelayMs,
}: {
  card: Card;
  revealed: boolean;
  dealDelayMs: number;
}) {
  return (
    <div className="suite7-flip suite7-dealt" style={{ animationDelay: `${dealDelayMs}ms` }}>
      <div className={`suite7-flip-inner${revealed ? " suite7-revealed" : ""}`}>
        <div className="suite7-flip-face">
          <div className="suite7-card suite7-card-back" role="img" aria-label="Face-down card" />
        </div>
        <div className="suite7-flip-face suite7-flip-front" aria-hidden={!revealed}>
          <CardFace card={card} />
        </div>
      </div>
    </div>
  );
}

/** Bankroll as overlapping chip discs — count scales gently with the stack. */
function ChipStack({ bankroll }: { bankroll: number | null }) {
  const discs =
    bankroll === null ? 3 : Math.min(8, Math.max(1, Math.floor(bankroll / 250) + 1));
  return (
    <div style={{ display: "flex", alignItems: "center" }} aria-hidden>
      {Array.from({ length: discs }, (_, i) => (
        <span key={i} className="suite7-chip-disc" style={{ marginLeft: i === 0 ? 0 : -15 }} />
      ))}
    </div>
  );
}
