"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Martini from "@/components/Martini";
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

/**
 * The Table — house blackjack, play-chips only. Purely cosmetic fun: chips
 * never touch the server (localStorage `suite7:chips`), no purchases, no API.
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
  const [result, setResult] = useState<Settlement | null>(null);
  const [shuffleNote, setShuffleNote] = useState(false);

  // Synchronous truth for guards + timer callbacks (state lags a render).
  const phaseRef = useRef<Phase>("BETTING");
  const bankrollRef = useRef<number | null>(null);
  const stakeRef = useRef(0);
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

  // Load bankroll after mount (SSR-safe: render "—" until then).
  useEffect(() => {
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
  }, []);

  // prefers-reduced-motion → all dealing delays collapse to zero.
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      reducedRef.current = mq.matches;
      const onChange = () => {
        reducedRef.current = mq.matches;
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

  const draw = useCallback((): Card => {
    if (shoeRef.current.length === 0) {
      // Can't happen with the between-rounds reshuffle, but never deal air.
      shoeRef.current = shuffle(buildShoe());
    }
    return shoeRef.current.pop() as Card;
  }, []);

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
        setChips((bankrollRef.current ?? DEFAULT_CHIPS) + settlement.delta);
        toPhase("SETTLED");
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
      return next;
    });
  }, []);

  const clearBet = useCallback(() => {
    if (phaseRef.current !== "BETTING") return;
    stakeRef.current = 0;
    setBet(0);
  }, []);

  const deal = useCallback(() => {
    if (phaseRef.current !== "BETTING") return;
    const chips = bankrollRef.current;
    const stake = stakeRef.current;
    if (chips === null || stake < MIN_BET || stake > chips) return;
    if (shoeRef.current.length < RESHUFFLE_BELOW) {
      shoeRef.current = shuffle(buildShoe());
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
  }, [draw, runDealer, setDealer, setPlayer, toPhase]);

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
    setBet(0);
    if (shoeRef.current.length < RESHUFFLE_BELOW) {
      shoeRef.current = shuffle(buildShoe());
      setShuffleNote(true);
    } else {
      setShuffleNote(false);
    }
    toPhase("BETTING");
  }, [setDealer, setPlayer, toPhase]);

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

  // ── Derived display values ─────────────────────────────────────────────
  const playerValue = playerHand.length ? handValue(playerHand) : null;
  const dealerValue = dealerHand.length ? handValue(dealerHand) : null;
  const canDouble =
    phase === "PLAYER" &&
    playerHand.length === 2 &&
    bankroll !== null &&
    bankroll >= bet * 2;
  const broke = phase === "BETTING" && bankroll !== null && bankroll < MIN_BET;

  return (
    <div className="suite7-table-wrap">
      <section className="suite7-felt" aria-label="Blackjack table">
        {/* Bankroll — chip stack + tabular count */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 26,
            paddingBottom: 18,
            borderBottom: "1px solid rgba(231,192,113,0.12)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ChipStack bankroll={bankroll} />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  fontFamily: "Georgia, serif",
                  color: "rgba(231,192,113,0.6)",
                }}
              >
                Bankroll
              </span>
              <span
                style={{
                  fontFamily: "Georgia, serif",
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 20,
                  color: CREAM,
                }}
              >
                {bankroll === null ? "—" : formatChips(bankroll)}
              </span>
            </div>
          </div>

          {shuffleNote && phase === "BETTING" ? (
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: 11,
                color: "rgba(245,240,240,0.45)",
              }}
            >
              shuffling the shoe…
            </span>
          ) : null}
        </div>

        {/* Dealer */}
        <HandRow
          label="Dealer"
          hand={dealerHand}
          holeIndex={1}
          holeRevealed={holeRevealed}
          totalText={
            dealerHand.length === 0 ? "" : holeRevealed && dealerValue ? String(dealerValue.total) : "?"
          }
        />

        {/* Center strip: result banner / dealer note */}
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

        {/* Player */}
        <HandRow
          label="You"
          hand={playerHand}
          holeIndex={-1}
          holeRevealed
          totalText={
            playerValue ? `${playerValue.total}${playerValue.soft ? " soft" : ""}` : ""
          }
        />

        {/* Controls */}
        <div style={{ marginTop: 24 }}>
          {phase === "BETTING" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 10 }} role="group" aria-label="Chip denominations">
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
                onClick={clearBet}
                disabled={bet === 0}
                aria-label={bet > 0 ? `Bet ${bet} — click to clear` : "No bet placed"}
                title={bet > 0 ? "Click to clear the bet" : undefined}
                style={{
                  background: "none",
                  border: "1px solid rgba(231,192,113,0.25)",
                  padding: "9px 16px",
                  cursor: bet > 0 ? "pointer" : "default",
                  fontFamily: "Georgia, serif",
                  color: bet > 0 ? GOLD : "rgba(245,240,240,0.35)",
                  fontSize: 12,
                  letterSpacing: 1,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                Bet {formatChips(bet)}
                {bet > 0 ? (
                  <span style={{ marginLeft: 8, fontSize: 9, color: "rgba(245,240,240,0.4)" }}>✕</span>
                ) : null}
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
            </div>
          ) : null}

          {phase === "PLAYER" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button type="button" className="suite7-btn suite7-btn-primary" onClick={hit}>
                Hit
              </button>
              <button type="button" className="suite7-btn" onClick={stand}>
                Stand
              </button>
              <button type="button" className="suite7-btn" onClick={doubleDown} disabled={!canDouble}>
                Double
              </button>
              <span
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: 10,
                  letterSpacing: 1.5,
                  color: "rgba(245,240,240,0.35)",
                }}
              >
                H — hit · S — stand
              </span>
            </div>
          ) : null}

          {phase === "SETTLED" ? (
            <button type="button" className="suite7-btn suite7-btn-primary" onClick={nextHand}>
              Next hand
            </button>
          ) : null}
        </div>

        {/* Table rules footnote */}
        <p
          style={{
            marginTop: 22,
            fontFamily: "Georgia, serif",
            fontSize: 9,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "rgba(231,192,113,0.35)",
          }}
        >
          Six decks · Dealer stands on all 17s · Blackjack pays 3:2
        </p>
      </section>

      <div className="suite7-martini-slot">
        <Martini />
      </div>
    </div>
  );
}

/* ── Presentational pieces ─────────────────────────────────────────────── */

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
