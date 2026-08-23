"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { tableAudio } from "@/lib/table-audio";
import { RANKS, SUITS, type Card, type Outcome, type Suit } from "@/lib/blackjack";

/**
 * TableScene — the 3D blackjack table (three.js).
 *
 * Stateless-reactive: TableGame's state machine stays the single source of
 * truth. This component diffs each incoming props snapshot against its own
 * display list and turns the differences into animations — new card → deal
 * from the shoe, holeCardHidden flipping false → hole-card flip, bet increase
 * → chip toss, SETTLED → payout / sweep. It never drives game state; the one
 * thing it sends UP is chip-rack clicks (onPlaceBet / onClearBet), which call
 * the exact same handlers as the DOM chip buttons.
 *
 * ── Blender integration ─────────────────────────────────────────────────────
 * /public/brand/table-assets.glb (Blender-authored) is loaded asynchronously
 * after the procedural scene is up. When it arrives it supplies:
 *   • the ENVIRONMENT — Table/Shoe/ChipTray/DiscardTray replace the procedural
 *     felt + shoe (which stay built and merely turn invisible: they are the
 *     permanent fallback if the load fails);
 *   • the CHIPS — Chip7 clones (materials cloned + tinted per denomination);
 *   • the ANIMATION CURVES — CardDeal / CardFlip / CardDiscard / ChipToss /
 *     ChipPayout / ChipSweep / ShoeRefill / TableIntro, retargeted onto the
 *     procedural cards and cloned chips by parenting each animated node under
 *     a per-instance wrapper Group and running a scoped AnimationMixer on that
 *     wrapper (the clips target node names "Card7S"/"Chip7"/"Shoe", so the
 *     animated node is given that name);
 *   • the MEASUREMENTS — every row/rack/rest height below is derived from
 *     Box3 measurements of the authored felt, trays and shoe (see
 *     measureFromGlb + solveLayout). Nothing about the table's footprint is
 *     hard-coded, so cards can never overhang the rail.
 * The PLAYING CARDS stay procedural geometry, but their faces come from
 * /public/brand/cards-atlas.png (13×5 cells); the canvas-painted faces remain
 * as the fallback if the atlas fails to load.
 * If the glb is missing or malformed the whole procedural scene keeps working.
 */

export type TablePhase = "BETTING" | "PLAYER" | "DEALER" | "SETTLED";

export interface TableSceneProps {
  playerHand: Card[];
  dealerHand: Card[];
  /** True while the dealer's second card is still face-down. */
  holeCardHidden: boolean;
  phase: TablePhase;
  /** Current total bet — increases toss chip meshes onto the betting circle. */
  betChips: number;
  /** Bankroll, for dimming rack stacks the player cannot afford. */
  bankroll: number | null;
  /** Bumped once per shoe reshuffle — plays ShoeRefill + the shuffle voice. */
  shuffleSeq: number;
  /** Settlement outcome for the win glow; null until SETTLED. */
  outcome: Outcome | null;
  /** Snap all animations to their final state; static camera. */
  reducedMotion: boolean;
  /** In-scene chip rack → the same handlers the DOM chip buttons call. */
  onPlaceBet: (denom: number) => void;
  onClearBet: () => void;
  /** Called once if the WebGL renderer cannot be created. */
  onFallback: () => void;
}

/* ── Palette (black + gold noir — matches globals.css suite7-*) ──────────── */

const GOLD = "#e3c071";
const GOLD_LIGHT = "#f7e8ac";
const CRIMSON = "#b21d3b";

/* Chip tints mirror the site's bet buttons (25 cream, 100 gold, 500 crimson). */
const CHIP_STYLE: Record<number, { light: string; mid: string; dark: string; text: string }> = {
  25: { light: "#fdfaf0", mid: "#cfc4a8", dark: "#8d8368", text: "#0a0805" },
  100: { light: "#f7e8ac", mid: "#b8934a", dark: "#6f5320", text: "#0a0805" },
  500: { light: "#d4526f", mid: "#b21d3b", dark: "#5f0f20", text: "#F5F0F0" },
};

/** Denominations in the in-scene rack, left → right. */
const RACK_DENOMS = [25, 100, 500] as const;
const RACK_STACK_HEIGHT = 4; // chips drawn per rack stack

/* ── World dimensions (arbitrary units, camera framed to fit) ────────────── */

const TABLE_W = 7.6;
const TABLE_D = 4.8;
const CARD_W = 0.72;
const CARD_H = 1.04;
/** Half the procedural card's visual thickness (face/back plane offset). */
const CARD_HALF_T = 0.008;
const CARD_GAP = 0.44; // fan overlap step at full size
const CHIP_R = 0.17;
const CHIP_H = 0.05;

/* ── The Blender glb contract (public/brand/table-assets.glb) ────────────── */

const GLB_URL = "/brand/table-assets.glb";
/** Authored table is 6.0 wide — scale it up to the old procedural footprint. */
const TABLE_SCALE = TABLE_W / 6.0;
/** Node / clip names inside the glb (verified author contract). */
const GLB_CARD_NODE = "Card7S";
const GLB_CHIP_NODE = "Chip7";
const GLB_SHOE_NODE = "Shoe";
const GLB_ENV_NODES = ["Table", "Shoe", "ChipTray", "DiscardTray"] as const;
/** Material names on the authored Table mesh (one sub-mesh per material). */
const MAT_FELT = "S7_Felt";
const MAT_FELT_PRINT = "S7_FeltPrint";
/** A laid glb card rests at local y = 0.020; ChipToss ends at y = 0.0305. */
const GLB_CARD_REST_Y = 0.02;
const GLB_CHIP_CLIP_Y = 0.0305;
/** Shoe's authored REST pose — the end of TableIntro. Its node transform is
    the intro's START pose, which parks it off the table edge, so the shoe must
    be moved here (or walked here by TableIntro) or cards deal from thin air. */
const GLB_SHOE_REST = new THREE.Vector3(1.92, 0.19353486, -1.1);
/** Betting circle in authored table space (matches ChipToss' final key). */
const GLB_BET_CENTER = new THREE.Vector2(0, 0.9);
const GLB_BET_RADIUS = 0.34;

/* Authored clip lengths are retimed to these READ-ABLE durations (seconds).
   timeScale is derived per clip, so a re-authored glb retimes itself. */
const DEAL_SECONDS = 1.12;
const FLIP_SECONDS = 0.8;
const DISCARD_SECONDS = 0.9;
const TOSS_SECONDS = 0.7;
const PAYOUT_SECONDS = 0.85;
const SWEEP_SECONDS = 0.95;
const REFILL_SECONDS = 1.5;
const INTRO_SECONDS = 2.2;
/** Gap between consecutive cards in the opening deal. */
const DEAL_STAGGER = 0.4;
/** Fraction of the deal at which the card actually touches the felt. */
const DEAL_TOUCHDOWN = 0.82;

const MAX_BET_CHIPS = 12; // visual cap — larger bets are implied
const MAX_PAYOUT_CHIPS = 8;
/** Widest half-span a fanned hand may occupy; beyond it the fan tightens. */
const ROW_HALF_SPAN_CAP = 1.85;

const CAM_BASE = new THREE.Vector3(0, 4.4, 4.9);
const CAM_TARGET = new THREE.Vector3(0, 0, -0.15);

/* ── Card atlas (public/brand/cards-atlas.png) ───────────────────────────── */

const ATLAS_URL = "/brand/cards-atlas.png";
const ATLAS_COLS = 13; // A,2,3,4,5,6,7,8,9,10,J,Q,K — same order as RANKS
const ATLAS_ROWS = 5; // ♠,♥,♦,♣ then the backs row
/** Card BACK lives in the bottom row, first column. */
const ATLAS_BACK_COL = 0;
const ATLAS_BACK_ROW = 4;

/* ── Small helpers ───────────────────────────────────────────────────────── */

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Greedy chip decomposition (500s → 100s → 25s) for bet/payout stacks. */
function denomsFor(amount: number): number[] {
  const out: number[] = [];
  let left = amount;
  for (const d of [500, 100, 25]) {
    while (left >= d) {
      out.push(d);
      left -= d;
    }
  }
  if (out.length === 0 && amount > 0) out.push(25); // never pay air (3:2 halves)
  return out;
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ── Procedural CanvasTextures (the atlas fallback + felt/chips) ─────────── */

/* Georgia's digits are old-style; Times gives the lining "7" the brand uses. */
const CARD_FONT = '"Times New Roman", Georgia, serif';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d") as CanvasRenderingContext2D];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Shared card frame: rounded near-black face + gold border, alpha corners. */
function paintCardFrame(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = 24;
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(w / 2, h * 0.16, 10, w / 2, h * 0.4, h * 1.05);
  g.addColorStop(0, "#171207");
  g.addColorStop(0.55, "#0a0805");
  g.addColorStop(1, "#000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  roundedRectPath(ctx, 2.5, 2.5, w - 5, h - 5, r - 2);
  ctx.strokeStyle = "rgba(227, 192, 113, 0.55)";
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRectPath(ctx, 9, 9, w - 18, h - 18, r - 7);
  ctx.strokeStyle = "rgba(227, 192, 113, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function paintCardFace(ctx: CanvasRenderingContext2D, w: number, h: number, card: Card) {
  paintCardFrame(ctx, w, h);
  const red = card.suit === "♥" || card.suit === "♦";
  const ink = red ? CRIMSON : GOLD;
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const corner = () => {
    ctx.font = `700 44px ${CARD_FONT}`;
    ctx.fillText(card.rank, 36, 40);
    ctx.font = `400 38px ${CARD_FONT}`;
    ctx.fillText(card.suit, 36, 82);
  };
  corner(); // top-left
  ctx.save(); // bottom-right, rotated 180° like a real index
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  corner();
  ctx.restore();

  ctx.font = `400 140px ${CARD_FONT}`;
  ctx.fillText(card.suit, w / 2, h / 2 + 6);
}

function paintCardBack(ctx: CanvasRenderingContext2D, w: number, h: number) {
  paintCardFrame(ctx, w, h);
  // Hairline gold weave inside an inner panel.
  ctx.save();
  roundedRectPath(ctx, 16, 16, w - 32, h - 32, 14);
  ctx.clip();
  ctx.lineWidth = 1;
  for (let d = -h; d < w + h; d += 9) {
    ctx.strokeStyle = "rgba(231, 192, 113, 0.11)";
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + h, h);
    ctx.stroke();
    ctx.strokeStyle = "rgba(231, 192, 113, 0.07)";
    ctx.beginPath();
    ctx.moveTo(d + h, 0);
    ctx.lineTo(d, h);
    ctx.stroke();
  }
  ctx.restore();
  roundedRectPath(ctx, 16, 16, w - 32, h - 32, 14);
  ctx.strokeStyle = "rgba(231, 192, 113, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "rgba(231, 192, 113, 0.2)";
  ctx.font = `400 110px ${CARD_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♠", w / 2, h / 2 + 4);
}

/** The felt: rounded table top, gold trim ring, lighting pool, betting circle.
    Only ever seen when the glb fails to load. */
function paintFelt(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = 84;
  roundedRectPath(ctx, 0, 0, w, h, r);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#0d0a06";
  ctx.fillRect(0, 0, w, h);
  // Soft radial lighting pool in the center.
  const cx = w / 2;
  const cy = h * 0.52;
  const pool = ctx.createRadialGradient(cx, cy, 20, cx, cy, w * 0.46);
  pool.addColorStop(0, "rgba(231, 192, 113, 0.11)");
  pool.addColorStop(0.5, "rgba(231, 192, 113, 0.04)");
  pool.addColorStop(1, "rgba(231, 192, 113, 0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);
  // Vignette toward the rails.
  const vig = ctx.createRadialGradient(cx, cy, w * 0.28, cx, cy, w * 0.62);
  vig.addColorStop(0, "rgba(0, 0, 0, 0)");
  vig.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Gold trim ring just inside the rail.
  roundedRectPath(ctx, 12, 12, w - 24, h - 24, r - 10);
  ctx.strokeStyle = "rgba(227, 192, 113, 0.4)";
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRectPath(ctx, 24, 24, w - 48, h - 48, r - 20);
  ctx.strokeStyle = "rgba(227, 192, 113, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function paintChipTop(ctx: CanvasRenderingContext2D, s: number, denom: number) {
  const st = CHIP_STYLE[denom] ?? CHIP_STYLE[25];
  const c = s / 2;
  const r = s / 2 - 2;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(c * 0.82, c * 0.78, 2, c, c, r);
  g.addColorStop(0, st.light);
  g.addColorStop(0.55, st.mid);
  g.addColorStop(1, st.dark);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Edge notch ticks — mirrors the site's dashed chip border.
  ctx.strokeStyle = "rgba(10, 6, 2, 0.55)";
  ctx.lineWidth = s * 0.055;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    ctx.lineTo(c + Math.cos(a) * (r - s * 0.09), c + Math.sin(a) * (r - s * 0.09));
    ctx.stroke();
  }
  ctx.restore();
  // Inner ring + the house "7".
  ctx.beginPath();
  ctx.arc(c, c, r * 0.6, 0, Math.PI * 2);
  ctx.strokeStyle = denom === 500 ? "rgba(247, 232, 172, 0.75)" : "rgba(10, 6, 2, 0.4)";
  ctx.lineWidth = s * 0.02;
  ctx.stroke();
  ctx.fillStyle = st.text;
  ctx.font = `700 ${s * 0.42}px ${CARD_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("7", c, c + s * 0.02);
}

/** One notch-stripe tile; RepeatWrapping wraps it 12× around the edge. */
function paintChipSide(ctx: CanvasRenderingContext2D, w: number, h: number, denom: number) {
  const st = CHIP_STYLE[denom] ?? CHIP_STYLE[25];
  ctx.fillStyle = st.dark;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = st.light;
  ctx.fillRect(w * 0.3, 0, w * 0.4, h);
}

/* ── Tween engine (single rAF loop drives everything) ────────────────────── */

interface Tween {
  t0: number; // scene-time start (seconds)
  dur: number; // seconds
  /** e = eased progress, k = raw progress, both 0→1. */
  update: (e: number, k: number) => void;
  done?: () => void;
}

/* ── Table metrics + solved layout ───────────────────────────────────────── */

/** Everything measured off the authored table (world units, post-TABLE_SCALE). */
interface FeltMetrics {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** World y of the felt surface. */
  top: number;
  /** Player-side edge of the dealer chip tray — the dealer row must clear it. */
  trayFrontZ: number;
  /** Right-hand x limit for a fanned row (discard tray / shoe stay clear). */
  rowHalfSpan: number;
  betCenter: THREE.Vector2;
  betRadius: number;
  chipRadius: number;
  chipHeight: number;
  /** Where the procedural (clip-less) deal arc starts. */
  shoeMouth: THREE.Vector3;
  /** Where payout chips come from. */
  payoutFrom: THREE.Vector3;
}

/** The solved placement every card, chip and rack slot is positioned from. */
interface Layout {
  metrics: FeltMetrics;
  cardScale: number;
  cardW: number;
  cardH: number;
  cardGap: number;
  /** World y a laid card's group sits at (bottom of the card ON the felt). */
  cardRestY: number;
  cardStackStep: number;
  dealerZ: number;
  playerZ: number;
  rowHalfSpan: number;
  chipRestY: number;
  chipStep: number;
  rack: { denom: number; x: number; z: number }[];
}

/** Procedural table metrics — used until (or unless) the glb lands. */
function proceduralMetrics(): FeltMetrics {
  const halfX = TABLE_W / 2;
  const halfZ = TABLE_D / 2;
  return {
    minX: -halfX,
    maxX: halfX,
    minZ: -halfZ,
    maxZ: halfZ,
    top: 0,
    // No authored tray in this mode — reserve a plausible dealer strip so the
    // solver still produces a full-size, fully contained layout.
    trayFrontZ: -halfZ + 1.5,
    rowHalfSpan: ROW_HALF_SPAN_CAP,
    betCenter: new THREE.Vector2(
      GLB_BET_CENTER.x * TABLE_SCALE,
      GLB_BET_CENTER.y * TABLE_SCALE
    ),
    betRadius: GLB_BET_RADIUS * TABLE_SCALE,
    chipRadius: CHIP_R,
    chipHeight: CHIP_H,
    shoeMouth: new THREE.Vector3(3.0, 0.5, -1.3),
    payoutFrom: new THREE.Vector3(-2.4, CHIP_H / 2, -1.7),
  };
}

/**
 * Turn measured table metrics into concrete row / rack placement.
 *
 * The rules, in order of priority:
 *   1. every card of a full hand stays inside the felt with a real margin;
 *   2. the dealer row clears the raised chip tray on the dealer side;
 *   3. the player row sits BEHIND the betting circle (dealer-ward), the way a
 *      real table lays out — never on top of the chips;
 *   4. if 1–3 cannot all hold at full card size, the CARDS shrink and the fan
 *      tightens. The table is never scaled up and the rows never move outward.
 */
function solveLayout(m: FeltMetrics): Layout {
  const MARGIN = 0.1; // felt-edge clearance
  const TRAY_GAP = 0.08; // clearance from the dealer's chip tray
  const ROW_GAP = 0.16; // clearance between the two card rows

  const backLimit = m.minZ + MARGIN;
  const frontLimit = m.trayFrontZ - TRAY_GAP;
  const dealerBand = Math.max(0.2, frontLimit - backLimit);
  // The player row must end before the betting circle begins.
  const circleBack = m.betCenter.y - m.betRadius - MARGIN;
  const roomForTwoRows = (circleBack - backLimit - ROW_GAP) / 2;

  const cardScale = THREE.MathUtils.clamp(
    Math.min(dealerBand, roomForTwoRows) / CARD_H,
    0.62,
    1
  );
  const cardH = CARD_H * cardScale;
  const cardW = CARD_W * cardScale;

  // Dealer row: centred in the band between the felt's back edge and the tray.
  const dealerZ = (backLimit + frontLimit) / 2;
  // Player row: as close to the betting circle as clearance allows.
  const playerMax = circleBack - cardH / 2;
  const playerMin = dealerZ + cardH + ROW_GAP;
  const playerZ = playerMax >= playerMin ? playerMax : (playerMin + playerMax) / 2;

  // Card rest height: the card's BOTTOM plane sits just above the felt.
  const cardRestY = m.top + CARD_HALF_T * cardScale + 0.005;
  const chipRestY = m.top + m.chipHeight / 2 + 0.002;

  // Chip rack: player side, clear of the betting circle in x and of the card
  // rows in z, fully inside the felt.
  const rackZ = m.maxZ - m.chipRadius - 0.16;
  const rackStep = m.chipRadius * 2 + 0.26;
  const rackX0 = m.betCenter.x + m.betRadius + m.chipRadius + 0.3;
  const rackMaxX = m.maxX - m.chipRadius - MARGIN;
  const rack = RACK_DENOMS.map((denom, i) => ({
    denom,
    x: Math.min(rackX0 + i * rackStep, rackMaxX - (RACK_DENOMS.length - 1 - i) * rackStep),
    z: rackZ,
  }));

  return {
    metrics: m,
    cardScale,
    cardW,
    cardH,
    cardGap: CARD_GAP * cardScale,
    cardRestY,
    cardStackStep: 0.006,
    dealerZ,
    playerZ,
    rowHalfSpan: Math.min(ROW_HALF_SPAN_CAP, m.rowHalfSpan),
    chipRestY,
    chipStep: m.chipHeight,
    rack,
  };
}

/* ── Controller ──────────────────────────────────────────────────────────── */

interface SyncProps {
  playerHand: Card[];
  dealerHand: Card[];
  holeCardHidden: boolean;
  phase: TablePhase;
  betChips: number;
  bankroll: number | null;
  shuffleSeq: number;
  outcome: Outcome | null;
  reducedMotion: boolean;
  onPlaceBet: (denom: number) => void;
  onClearBet: () => void;
}

interface Controller {
  sync(p: SyncProps): void;
  dispose(): void;
}

interface CardEntry {
  /** Outermost scene node (glb-clip mode: the retarget wrapper). */
  group: THREE.Group;
  /** The node the authored clips animate — named "Card7S" in glb-clip mode. */
  card: THREE.Group;
  /** Flight/landing scale, kept separate so it never fights the retarget. */
  squash: THREE.Group;
  /** rotation.z = PI while face-down. */
  flip: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  faceDown: boolean;
  /** Mutable world target — relayoutRow() rewrites it and everything follows. */
  home: THREE.Vector3;
  jitter: number;
  dealing: boolean;
  /** True when the authored CardDeal drives this card. */
  usingClip: boolean;
}

interface RackStack {
  denom: number;
  group: THREE.Group;
  chips: THREE.Object3D[];
  mats: THREE.MeshStandardMaterial[];
  baseColors: THREE.Color[];
  hit: THREE.Mesh;
  enabled: boolean;
  hovered: boolean;
  lift: number;
}

type HitTarget = { kind: "rack"; stack: RackStack } | { kind: "bet" };

const SUIT_KEYS: Record<Suit, string> = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };

/** Throws if WebGL is unavailable — the caller falls back to DOM cards. */
function createController(mount: HTMLDivElement): Controller {
  const audio = tableAudio();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  const camBase = CAM_BASE.clone();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  /* One-time diagnostics: silent failures used to look like "cards popped". */
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[TableScene] ${message}`);
  };

  /* ── Image-based environment (gold + rails actually glint) ─────────────── */

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.42; // a hint of room, not a showroom
  roomScene.dispose();

  /** Scratch vectors — the render loop must never allocate. */
  const _vA = new THREE.Vector3();
  const _vB = new THREE.Vector3();

  /* Texture cache — one entry per painted face, one back, felt, chips.
     NEVER regenerated per frame; disposed once on unmount. */
  const texCache = new Map<string, THREE.CanvasTexture>();
  const getTexture = (
    key: string,
    w: number,
    h: number,
    paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  ): THREE.CanvasTexture => {
    let tex = texCache.get(key);
    if (!tex) {
      const [canvas, ctx] = makeCanvas(w, h);
      paint(ctx, w, h);
      tex = toTexture(canvas);
      texCache.set(key, tex);
    }
    return tex;
  };
  const getPaintedFace = (card: Card) =>
    getTexture(`face:${card.rank}${SUIT_KEYS[card.suit]}`, 256, 372, (ctx, w, h) =>
      paintCardFace(ctx, w, h, card)
    );
  const getPaintedBack = () =>
    getTexture("back", 256, 372, (ctx, w, h) => paintCardBack(ctx, w, h));

  /* ── The card atlas: one image, one clone per (rank,suit) + back ───────── */

  let atlas: THREE.Texture | null = null;
  const atlasCells = new Map<string, THREE.Texture>();

  /** A clipped clone of the atlas showing exactly one cell. */
  function atlasCell(col: number, row: number): THREE.Texture | null {
    if (!atlas) return null;
    const key = `${col}:${row}`;
    let tex = atlasCells.get(key);
    if (!tex) {
      // Clones share the underlying Source, so all 53 cells are ONE GPU upload.
      tex = atlas.clone();
      tex.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS);
      tex.offset.set(col / ATLAS_COLS, 1 - (row + 1) / ATLAS_ROWS);
      tex.needsUpdate = true;
      atlasCells.set(key, tex);
    }
    return tex;
  }

  /** A♠ = col 0/row 0 · K♣ = col 12/row 3 · back = col 0/row 4. */
  const faceTexture = (card: Card): THREE.Texture =>
    atlasCell(RANKS.indexOf(card.rank), SUITS.indexOf(card.suit)) ?? getPaintedFace(card);
  const backTexture = (): THREE.Texture =>
    atlasCell(ATLAS_BACK_COL, ATLAS_BACK_ROW) ?? getPaintedBack();

  /** Repoint every live card material at the atlas once it arrives. */
  function adoptAtlas(tex: THREE.Texture) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    // No mipmaps: sub-rect cells would bleed into their neighbours at low LODs.
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    atlas = tex;
    for (const row of [rows.player, rows.dealer]) {
      for (const entry of row) {
        const [faceMat, backMat] = entry.mats;
        if (entry.cardRef) faceMat.map = faceTexture(entry.cardRef);
        backMat.map = backTexture();
        faceMat.needsUpdate = true;
        backMat.needsUpdate = true;
      }
    }
  }

  /* Shared geometries (a handful total, whatever the hand count). */
  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const feltGeo = new THREE.PlaneGeometry(TABLE_W, TABLE_D);
  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 24);
  const shoeGeo = new THREE.BoxGeometry(0.56, 0.4, 0.78);
  const ringGeo = new THREE.RingGeometry(0.955, 1, 72);
  const hitGeo = new THREE.CylinderGeometry(1, 1, 0.6, 12);

  const sharedDisposables: { dispose(): void }[] = [
    cardGeo,
    feltGeo,
    chipGeo,
    shoeGeo,
    ringGeo,
    hitGeo,
  ];

  /* The felt (procedural fallback — hidden the moment the glb lands). */
  const feltTex = getTexture("felt", 1024, 648, paintFelt);
  const feltMat = new THREE.MeshStandardMaterial({
    map: feltTex,
    transparent: true,
    alphaTest: 0.3,
    roughness: 0.95,
    metalness: 0,
  });
  sharedDisposables.push(feltMat);
  const felt = new THREE.Mesh(feltGeo, feltMat);
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  /* The shoe — a quiet dark block (procedural fallback). */
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.6, metalness: 0.3 });
  const shoeEdgeMat = new THREE.LineBasicMaterial({ color: 0xe3c071, transparent: true, opacity: 0.35 });
  const shoeEdges = new THREE.EdgesGeometry(shoeGeo);
  sharedDisposables.push(shoeMat, shoeEdgeMat, shoeEdges);
  const shoe = new THREE.Mesh(shoeGeo, shoeMat);
  shoe.position.set(3.0, 0.2, -1.3);
  shoe.rotation.y = -0.35;
  shoe.castShadow = true;
  shoe.add(new THREE.LineSegments(shoeEdges, shoeEdgeMat));
  scene.add(shoe);

  /* The betting circle. The authored felt has no printed circle (the print is
     the centre lettering, which we hide), so this ring IS the circle. */
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GOLD),
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  sharedDisposables.push(ringMat);
  const betRing = new THREE.Mesh(ringGeo, ringMat);
  betRing.rotation.x = -Math.PI / 2;
  betRing.renderOrder = 2;
  scene.add(betRing);

  /* Chip materials — cached per denomination for the procedural chips. */
  const chipMats = new Map<number, THREE.Material[]>();
  const getChipMats = (denom: number): THREE.Material[] => {
    let mats = chipMats.get(denom);
    if (!mats) {
      const side = getTexture(`chip-side:${denom}`, 32, 16, (ctx, w, h) =>
        paintChipSide(ctx, w, h, denom)
      );
      side.wrapS = THREE.RepeatWrapping;
      side.repeat.set(12, 1);
      const top = getTexture(`chip-top:${denom}`, 128, 128, (ctx) => paintChipTop(ctx, 128, denom));
      const sideMat = new THREE.MeshStandardMaterial({ map: side, roughness: 0.55, metalness: 0.15 });
      const topMat = new THREE.MeshStandardMaterial({ map: top, roughness: 0.5, metalness: 0.2 });
      mats = [sideMat, topMat, topMat];
      chipMats.set(denom, mats);
      sharedDisposables.push(sideMat, topMat);
    }
    return mats;
  };

  /* ── Lighting: PBR needs more than MeshBasic did ──────────────────────── */

  const ambient = new THREE.AmbientLight(0x8a7550, 0.55);
  const key = new THREE.DirectionalLight(0xffe9c4, 1.35);
  key.position.set(2.2, 7.2, 4.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.024;
  key.shadow.radius = 3;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -4.3;
  shadowCam.right = 4.3;
  shadowCam.top = 3.0;
  shadowCam.bottom = -3.0;
  shadowCam.near = 1.5;
  shadowCam.far = 20;
  shadowCam.updateProjectionMatrix();

  const rim = new THREE.DirectionalLight(0xe3c071, 0.42);
  rim.position.set(-3.2, 3, -5);

  /* The house lamp: a warm cone that pools on the felt and dies at the rails. */
  const spot = new THREE.SpotLight(0xffdfae, 95, 20, 0.62, 0.92, 2);
  spot.position.set(0, 6.4, 0.5);
  spot.target.position.set(0, 0, -0.2);

  const pulse = new THREE.PointLight(0xf7e8ac, 0, 6, 2);
  pulse.position.set(0, 1.15, 0);
  scene.add(ambient, key, rim, spot, spot.target, pulse);

  /* ── Animation clock + tween list ─────────────────────────────────────── */

  let reduced = false;
  let now = 0;
  const tweens: Tween[] = [];
  const tween = (
    delay: number,
    dur: number,
    update: (e: number, k: number) => void,
    done?: () => void
  ) => {
    if (reduced) {
      update(1, 1);
      done?.();
      return;
    }
    tweens.push({ t0: now + delay, dur, update, done });
  };
  /** Fire `fn` after `delay` (immediately under reduced motion). */
  const at = (delay: number, fn: () => void) => {
    if (reduced || delay <= 0) {
      fn();
      return;
    }
    tweens.push({ t0: now + delay, dur: 0.0001, update: () => {}, done: fn });
  };
  const stepTweens = () => {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (now < tw.t0) continue;
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.update(easeOutCubic(k), k);
      if (k >= 1) {
        tweens.splice(i, 1);
        tw.done?.();
      }
    }
  };

  /* ── Blender glb: state, retarget mixers, async adoption ──────────────── */

  let disposed = false;
  let glbEnv: THREE.Group | null = null; // Table/Shoe/ChipTray/DiscardTray
  let glbClips: Record<string, THREE.AnimationClip> = {};
  let glbChipTemplate: THREE.Object3D | null = null;
  const glbDisposables: { dispose(): void }[] = [];
  /* Tinted material clones, cached per denomination (keyed by source uuid). */
  const glbChipMats = new Map<number, Map<string, THREE.Material>>();

  let layout = solveLayout(proceduralMetrics());

  /* One scoped AnimationMixer per animated instance, driven by the rAF dt. */
  const activeMixers = new Set<THREE.AnimationMixer>();

  /**
   * AUDIT GUARD. An AnimationAction whose tracks resolve to nothing still runs
   * its clock and still fires "finished" — the object simply never moves and
   * then snaps into place. That is indistinguishable from a card popping into
   * existence, so every clip is bind-checked BEFORE it is played and a failure
   * routes to the procedural (always-animated) path instead of playing a
   * silent no-op.
   */
  function bindsCleanly(root: THREE.Object3D, clip: THREE.AnimationClip, label: string): boolean {
    for (const track of clip.tracks) {
      const dot = track.name.indexOf(".");
      const nodeName = dot === -1 ? track.name : track.name.slice(0, dot);
      if (!nodeName) continue;
      if (root.name === nodeName) continue;
      if (root.getObjectByName(nodeName)) continue;
      warnOnce(
        `bind:${label}:${nodeName}`,
        `clip "${clip.name}" has a track for node "${nodeName}" that is not in the ` +
          `${label} hierarchy — falling back to the procedural animation.`
      );
      return false;
    }
    return true;
  }

  /** Put `node` on a clip's first keyframe so it is never parked elsewhere
      while a delayed action waits to start. (The glb's rest poses are the
      TableIntro START poses, i.e. off-table — this is what used to make chips
      hover in mid-air before their toss began.) */
  function primeToClipStart(node: THREE.Object3D, clip: THREE.AnimationClip, nodeName: string) {
    for (const track of clip.tracks) {
      const dot = track.name.indexOf(".");
      if (dot === -1 || track.name.slice(0, dot) !== nodeName) continue;
      const prop = track.name.slice(dot + 1);
      const v = track.values;
      if (prop === "position") node.position.set(v[0], v[1], v[2]);
      else if (prop === "quaternion") node.quaternion.set(v[0], v[1], v[2], v[3]);
      else if (prop === "scale") node.scale.set(v[0], v[1], v[2]);
    }
  }

  /** Play an authored clip once on `root`'s subtree, retimed to `seconds`.
      `snap` sets the exact rest pose on 'finished' (and immediately under
      reducedMotion). Returns false when the clip could not bind. */
  function playClip(
    root: THREE.Object3D,
    clip: THREE.AnimationClip,
    seconds: number,
    delay: number,
    snap: () => void,
    label = "instance"
  ): boolean {
    if (reduced) {
      snap();
      return true;
    }
    if (!bindsCleanly(root, clip, label)) return false;
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = clip.duration / Math.max(0.05, seconds);
    if (delay > 0) action.startAt(delay);
    action.play();
    mixer.addEventListener("finished", () => {
      activeMixers.delete(mixer);
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      snap();
    });
    activeMixers.add(mixer);
    return true;
  }

  /** Clone the glb Chip7, re-tinting cloned materials toward the denom color.
      Pass a private `cache` to get materials nothing else shares (rack stacks
      tint + glow on hover and must not drag every chip on the felt with them). */
  function cloneGlbChip(denom: number, cache?: Map<string, THREE.Material>): THREE.Object3D {
    const chip = (glbChipTemplate as THREE.Object3D).clone(true);
    chip.visible = true;
    // A private cache means the CALLER owns (and disposes) the clones.
    const owned = cache === undefined;
    let tints = cache;
    if (!tints) {
      tints = glbChipMats.get(denom);
      if (!tints) {
        tints = new Map();
        glbChipMats.set(denom, tints);
      }
    }
    const store = tints;
    const style = CHIP_STYLE[denom] ?? CHIP_STYLE[25];
    const tint = new THREE.Color(style.mid);
    chip.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const remap = (mat: THREE.Material): THREE.Material => {
        let clone = store.get(mat.uuid);
        if (!clone) {
          clone = mat.clone();
          const std = clone as THREE.MeshStandardMaterial;
          if (std.color) std.color.lerp(tint, 0.55);
          if (std.emissive) {
            std.emissive = new THREE.Color(GOLD_LIGHT);
            std.emissiveIntensity = 0;
          }
          store.set(mat.uuid, clone);
          if (owned) glbDisposables.push(clone);
        }
        return clone;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(remap) : remap(mesh.material);
    });
    return chip;
  }

  function buildChipMesh(denom: number): THREE.Object3D {
    if (glbChipTemplate) {
      const chip = cloneGlbChip(denom);
      chip.position.set(0, 0, 0);
      chip.quaternion.identity();
      chip.scale.setScalar(TABLE_SCALE);
      return chip;
    }
    const mesh = new THREE.Mesh(chipGeo, getChipMats(denom));
    mesh.castShadow = true;
    return mesh;
  }

  /* ── Measuring the authored table ─────────────────────────────────────── */

  /** World-space Box3 of every sub-mesh in `root` using material `matName`. */
  function boxOfMaterial(root: THREE.Object3D, matName: string): THREE.Box3 | null {
    let box: THREE.Box3 | null = null;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!mats.some((m) => m.name === matName)) return;
      const b = new THREE.Box3().setFromObject(mesh);
      box = box === null ? b : (box as THREE.Box3).union(b);
    });
    return box;
  }

  /** Hide ONLY the printed felt lettering; felt, rail, trim and tray stay. */
  function hideFeltPrint(root: THREE.Object3D): boolean {
    let hid = false;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // The authored Table is one sub-mesh per material, so hiding the mesh
      // hides exactly the print. A merged multi-material mesh would still be
      // handled correctly by the material.visible fallback below.
      if (mats.every((m) => m.name === MAT_FELT_PRINT)) {
        mesh.visible = false;
        hid = true;
        return;
      }
      for (const m of mats) {
        if (m.name === MAT_FELT_PRINT) {
          m.visible = false;
          hid = true;
        }
      }
    });
    return hid;
  }

  function measureFromGlb(root: THREE.Object3D): FeltMetrics {
    const base = proceduralMetrics();
    const table = root.getObjectByName("Table");
    const feltBox =
      (table && boxOfMaterial(table, MAT_FELT)) ??
      (table ? new THREE.Box3().setFromObject(table) : null);
    if (!feltBox) return base;

    const m: FeltMetrics = {
      ...base,
      minX: feltBox.min.x,
      maxX: feltBox.max.x,
      minZ: feltBox.min.z,
      maxZ: feltBox.max.z,
      top: feltBox.max.y,
      betCenter: new THREE.Vector2(
        GLB_BET_CENTER.x * TABLE_SCALE,
        GLB_BET_CENTER.y * TABLE_SCALE
      ),
      betRadius: GLB_BET_RADIUS * TABLE_SCALE,
      shoeMouth: base.shoeMouth.clone(),
      payoutFrom: base.payoutFrom.clone(),
    };

    // The dealer's raised chip tray is the dealer row's front wall.
    const tray = root.getObjectByName("ChipTray");
    if (tray) {
      const b = new THREE.Box3().setFromObject(tray);
      m.trayFrontZ = b.max.z;
      b.getCenter(m.payoutFrom);
      m.payoutFrom.y = m.top + m.chipHeight / 2;
    } else {
      m.trayFrontZ = m.minZ + (m.maxZ - m.minZ) * 0.28;
    }

    // Rows must also stay clear of the discard tray (left) and shoe (right).
    let halfSpan = Math.min(Math.abs(m.minX), m.maxX) - 0.1;
    const discard = root.getObjectByName("DiscardTray");
    if (discard) {
      const b = new THREE.Box3().setFromObject(discard);
      halfSpan = Math.min(halfSpan, Math.abs(b.max.x) - 0.12);
    }
    const shoeNode = root.getObjectByName(GLB_SHOE_NODE);
    if (shoeNode) {
      const b = new THREE.Box3().setFromObject(shoeNode);
      halfSpan = Math.min(halfSpan, b.min.x - 0.12);
      // The clip-less deal arc starts at the shoe's mouth.
      m.shoeMouth.set(b.min.x + (b.max.x - b.min.x) * 0.35, b.max.y * 0.8, b.max.z);
    }
    m.rowHalfSpan = Math.max(0.9, Math.min(ROW_HALF_SPAN_CAP, halfSpan));

    // Chip metrics straight off the authored Chip7.
    const chipNode = root.getObjectByName(GLB_CHIP_NODE);
    if (chipNode) {
      const b = new THREE.Box3().setFromObject(chipNode);
      m.chipRadius = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
      m.chipHeight = b.max.y - b.min.y;
    }
    return m;
  }

  /** Re-seat everything already on the table after a layout change. */
  function applyLayout(next: Layout) {
    layout = next;
    const m = next.metrics;
    betRing.position.set(m.betCenter.x, m.top + 0.004, m.betCenter.y);
    betRing.scale.setScalar(m.betRadius);
    relayoutRow("player");
    relayoutRow("dealer");
    buildRack();
  }

  /** Swap the environment + chips + clips in once the glb has loaded. */
  function adoptGlb(gltf: GLTF) {
    const root = gltf.scene;
    for (const name of GLB_ENV_NODES) {
      if (!root.getObjectByName(name)) throw new Error(`glb is missing node "${name}"`);
    }
    root.scale.setScalar(TABLE_SCALE);

    // The Shoe's node transform is TableIntro's START pose — off the table
    // edge. Park it at the intro's END pose so cards leave a real shoe.
    const shoeNode = root.getObjectByName(GLB_SHOE_NODE);
    if (shoeNode) shoeNode.position.copy(GLB_SHOE_REST);

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      glbDisposables.push(mesh.geometry);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        glbDisposables.push(mat);
        const std = mat as THREE.MeshStandardMaterial;
        const map = std.map;
        if (map) glbDisposables.push(map);
        // Gold catches the room; the dark felt/rail must stay dark.
        if (std.isMeshStandardMaterial) {
          std.envMapIntensity = /Gold|Lip|Pip/i.test(std.name) ? 1.15 : 0.35;
        }
      }
    });
    const table = root.getObjectByName("Table");
    if (table) {
      table.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = false; // the table only receives
      });
      if (!hideFeltPrint(table)) {
        warnOnce("feltprint", `no "${MAT_FELT_PRINT}" material found — felt print left visible.`);
      }
    }

    // The template card/chip are clone/animation sources, never shown as-is.
    const cardTemplate = root.getObjectByName(GLB_CARD_NODE);
    if (cardTemplate) cardTemplate.visible = false;
    const chipTemplate = root.getObjectByName(GLB_CHIP_NODE) ?? null;
    if (chipTemplate) chipTemplate.visible = false;

    scene.add(root);
    root.updateMatrixWorld(true);

    // The procedural felt + shoe stay built (permanent fallback) but hidden.
    felt.visible = false;
    shoe.visible = false;

    for (const clip of gltf.animations) glbClips[clip.name] = clip;
    for (const wanted of [
      "CardDeal",
      "CardFlip",
      "CardDiscard",
      "ChipToss",
      "ChipPayout",
      "ChipSweep",
      "ShoeRefill",
      "TableIntro",
    ]) {
      if (!glbClips[wanted]) {
        warnOnce(`clip:${wanted}`, `clip "${wanted}" is missing from the glb — using the procedural fallback.`);
      }
    }
    glbChipTemplate = chipTemplate;
    glbEnv = root;

    applyLayout(solveLayout(measureFromGlb(root)));
    playIntro(root);
  }

  /** TableIntro + the camera push-in. Skipped entirely under reduced motion. */
  function playIntro(root: THREE.Object3D) {
    if (reduced) return;
    if (rows.player.length || rows.dealer.length) return; // mid-hand load
    const intro = glbClips.TableIntro;
    const shoeNode = root.getObjectByName(GLB_SHOE_NODE);
    if (intro && shoeNode) {
      primeToClipStart(shoeNode, intro, GLB_SHOE_NODE);
      const played = playClip(
        root,
        intro,
        INTRO_SECONDS,
        0,
        () => shoeNode.position.copy(GLB_SHOE_REST),
        "glb root"
      );
      if (!played) shoeNode.position.copy(GLB_SHOE_REST);
    }
    camIntro = 1;
    tween(0, INTRO_SECONDS, (e) => {
      camIntro = 1 - e;
    });
  }

  /* ── Display lists ────────────────────────────────────────────────────── */

  const rows: { player: (CardEntry & { cardRef?: Card })[]; dealer: (CardEntry & { cardRef?: Card })[] } = {
    player: [],
    dealer: [],
  };
  const betStack: THREE.Object3D[] = []; // chips currently on the betting circle
  const transientChips: THREE.Object3D[] = []; // payout / swept chips mid-flight
  const discarding = new Set<CardEntry>(); // cards mid-CardDiscard
  const rackStacks: RackStack[] = [];
  const hitMeshes: THREE.Mesh[] = [];
  let betHit: THREE.Mesh | null = null;
  let lastBet = 0;
  let lastShuffleSeq = -1;
  let settledHandled = false;
  let phase: TablePhase = "BETTING";
  let bankroll: number | null = null;
  let hovered: HitTarget | null = null;
  let camIntro = 0; // 1 → fully pulled back, 0 → play framing
  let camNudge = 0; // small push-in on a win
  let onPlaceBet: (denom: number) => void = () => {};
  let onClearBet: () => void = () => {};

  /* Cards ---------------------------------------------------------------- */

  function buildCardMesh(card: Card | "back"): {
    group: THREE.Group;
    squash: THREE.Group;
    flip: THREE.Group;
    mats: THREE.MeshStandardMaterial[];
  } {
    const back = backTexture();
    const face = card === "back" ? back : faceTexture(card);
    const mkMat = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        alphaTest: 0.35,
        roughness: 0.62,
        metalness: 0.04,
        envMapIntensity: 0.5,
        emissive: new THREE.Color(GOLD_LIGHT),
        emissiveIntensity: 0,
      });
    const faceMat = mkMat(face);
    const backMat = mkMat(back);
    const faceMesh = new THREE.Mesh(cardGeo, faceMat);
    faceMesh.rotation.x = -Math.PI / 2; // lie flat, face up, top toward the dealer
    faceMesh.position.y = CARD_HALF_T;
    faceMesh.castShadow = true;
    const backMesh = new THREE.Mesh(cardGeo, backMat);
    backMesh.rotation.x = Math.PI / 2; // underside
    backMesh.position.y = -CARD_HALF_T;
    backMesh.castShadow = true;
    const flip = new THREE.Group();
    flip.add(faceMesh, backMesh);
    const squash = new THREE.Group();
    squash.add(flip);
    const group = new THREE.Group();
    group.add(squash);
    return { group, squash, flip, mats: [faceMat, backMat] };
  }

  /** Fan slot i of an n-card hand — always centred, always inside the felt. */
  function slotFor(row: "player" | "dealer", i: number, n: number): THREE.Vector3 {
    const count = Math.max(2, n);
    // Extra cards TIGHTEN the fan rather than pushing the row outward.
    const gap = Math.min(
      layout.cardGap,
      (layout.rowHalfSpan * 2 - layout.cardW) / Math.max(1, count - 1)
    );
    const x0 = -((count - 1) * gap) / 2;
    return new THREE.Vector3(
      x0 + i * gap,
      layout.cardRestY + i * layout.cardStackStep,
      row === "player" ? layout.playerZ : layout.dealerZ
    );
  }

  /** Where the card's outermost node must sit for the card to land on `home`.
      Writes into `out` — this runs per frame during a deal. */
  function groupPosFor(entry: CardEntry, home: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(home);
    if (entry.usingClip) out.y -= GLB_CARD_REST_Y * TABLE_SCALE;
    return out;
  }

  /** Re-centre a row after its card count (or the layout) changed. */
  function relayoutRow(row: "player" | "dealer") {
    const list = rows[row];
    list.forEach((entry, i) => {
      const next = slotFor(row, i, list.length);
      if (entry.home.distanceToSquared(next) < 1e-8) return;
      entry.home.copy(next);
      if (entry.dealing) return; // its deal tween reads `home` live
      const from = entry.group.position.clone();
      const to = groupPosFor(entry, entry.home, new THREE.Vector3());
      tween(0, 0.24, (e) => {
        entry.group.position.lerpVectors(from, to, e);
      });
    });
  }

  /**
   * Flight polish, as one continuous curve so nothing fights for the scale:
   * swell ~6% toward the apex, then a 0.99 micro-squash at touchdown that
   * resolves over ~60 ms.
   */
  function flightScale(entry: CardEntry, k: number) {
    if (k <= DEAL_TOUCHDOWN) {
      entry.squash.scale.setScalar(1 + 0.06 * Math.sin(Math.PI * (k / DEAL_TOUCHDOWN)));
      return;
    }
    const u = Math.min(1, ((k - DEAL_TOUCHDOWN) * DEAL_SECONDS) / 0.06);
    const s = 0.99 + 0.01 * easeOutCubic(u);
    entry.squash.scale.set(s, 1, s);
  }

  function addCard(row: "player" | "dealer", card: Card, faceDown: boolean, delay: number) {
    const list = rows[row];
    const i = list.length;
    const jitter = rand(-1, 1) * ((2 * Math.PI) / 180); // ±2° fan wobble
    const { group, squash, flip, mats } = buildCardMesh(card);
    if (faceDown) flip.rotation.z = Math.PI;
    group.scale.setScalar(layout.cardScale);

    const deal = glbClips.CardDeal;
    const useClip = Boolean(deal) && !reduced;

    const entry: CardEntry & { cardRef?: Card } = {
      group,
      card: group,
      squash,
      flip,
      mats,
      faceDown,
      home: slotFor(row, i, i + 1),
      jitter,
      dealing: true,
      usingClip: false,
      cardRef: card,
    };

    if (useClip) {
      // Authored CardDeal, retargeted: the clip animates a node named "Card7S"
      // from inside the Shoe to the glb-space origin, so the procedural card
      // group takes that name and goes under a wrapper whose position lerps
      // origin → slot. At k=0 the card sits exactly in the glb Shoe (env and
      // wrapper share scale + origin); at k=1 the clip's authored rest lands
      // exactly on the slot — both rows, no mirroring.
      const inner = group;
      inner.name = GLB_CARD_NODE;
      inner.scale.setScalar(1);
      squash.scale.setScalar(1);
      flip.scale.setScalar(layout.cardScale / TABLE_SCALE);
      primeToClipStart(inner, deal, GLB_CARD_NODE);
      const wrapper = new THREE.Group();
      wrapper.scale.setScalar(TABLE_SCALE);
      wrapper.rotation.y = jitter;
      wrapper.add(inner);
      entry.group = wrapper;
      entry.card = inner;
      entry.usingClip = true;

      list.push(entry);
      relayoutRow(row);
      scene.add(wrapper);

      const played = playClip(
        wrapper,
        deal,
        DEAL_SECONDS,
        delay,
        () => {
          entry.dealing = false;
          wrapper.position.copy(groupPosFor(entry, entry.home, _vA));
          entry.squash.scale.setScalar(1);
          inner.position.set(0, GLB_CARD_REST_Y, 0);
          inner.quaternion.identity();
        },
        "card wrapper"
      );

      if (played) {
        at(delay, () => audio.play("cardSlide"));
        tween(delay, DEAL_SECONDS, (e, k) => {
          const to = groupPosFor(entry, entry.home, _vA);
          wrapper.position.set(to.x * e, to.y * e, to.z * e);
          flightScale(entry, k);
        });
        at(delay + DEAL_SECONDS * DEAL_TOUCHDOWN, () => audio.play("cardLand"));
        return;
      }
      // Bind failed (already warned) — fall through to the procedural arc.
      scene.remove(wrapper);
      wrapper.remove(inner);
      inner.name = "";
      inner.scale.setScalar(layout.cardScale);
      flip.scale.setScalar(1);
      entry.group = inner;
      entry.card = inner;
      entry.usingClip = false;
      list.splice(list.indexOf(entry), 1);
    }

    // Procedural deal (also the reduced-motion snap path): a real parabolic
    // arc out of the shoe, spin settling. Never an instant appear.
    const from = layout.metrics.shoeMouth;
    group.position.copy(from);
    group.rotation.y = jitter + 1.4;
    scene.add(group);
    list.push(entry);
    relayoutRow(row);
    at(delay, () => audio.play("cardSlide"));
    tween(
      delay,
      DEAL_SECONDS,
      (e, k) => {
        const to = entry.home;
        group.position.x = from.x + (to.x - from.x) * e;
        group.position.z = from.z + (to.z - from.z) * e;
        group.position.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * 0.5;
        group.rotation.y = jitter + (1 - e) * 1.4;
        flightScale(entry, k);
      },
      () => {
        entry.dealing = false;
        entry.squash.scale.setScalar(1);
        group.position.copy(entry.home);
      }
    );
    at(delay + DEAL_SECONDS * DEAL_TOUCHDOWN, () => audio.play("cardLand"));
  }

  function removeCard(entry: CardEntry) {
    scene.remove(entry.group);
    for (const m of entry.mats) m.dispose(); // textures stay cached
  }

  /** Authored CardDiscard — a swept card slides into the DiscardTray. */
  function discardCard(entry: CardEntry, delay: number): boolean {
    const clip = glbClips.CardDiscard;
    if (!clip || !entry.usingClip) return false;
    const wrapper = entry.group;
    const base = wrapper.position.clone();
    const played = playClip(
      wrapper,
      clip,
      DISCARD_SECONDS,
      delay,
      () => {
        discarding.delete(entry);
        scene.remove(wrapper);
        for (const m of entry.mats) m.dispose();
      },
      "card wrapper"
    );
    if (!played) return false;
    discarding.add(entry);
    tween(delay, DISCARD_SECONDS, (e) => {
      wrapper.position.copy(base).multiplyScalar(1 - e);
    });
    return true;
  }

  function clearRow(row: "player" | "dealer") {
    rows[row].forEach((entry, i) => {
      if (!disposed && !reduced && discardCard(entry, i * 0.06)) return;
      removeCard(entry);
    });
    rows[row].length = 0;
  }

  /** Hole-card reveal: the authored CardFlip, or a lift-and-roll fallback. */
  function flipHole(entry: CardEntry) {
    entry.faceDown = false;
    const { flip, group, card } = entry;
    audio.play("cardFlip");
    const clip = glbClips.CardFlip;
    if (clip && entry.usingClip) {
      // Authored CardFlip ends clamped at rotation π about the long axis;
      // combined with the face-down flip group's π the card reads face-up
      // (2π). The snap collapses both back to 0 — visually identical.
      const played = playClip(
        group,
        clip,
        FLIP_SECONDS,
        0,
        () => {
          flip.rotation.z = 0;
          card.position.set(0, GLB_CARD_REST_Y, 0);
          card.quaternion.identity();
        },
        "card wrapper"
      );
      if (played) return;
    }
    const restY = entry.home.y;
    tween(0, FLIP_SECONDS, (e, k) => {
      flip.rotation.z = Math.PI * (1 - e);
      group.position.y = (entry.usingClip ? restY - GLB_CARD_REST_Y * TABLE_SCALE : restY) +
        Math.sin(Math.PI * k) * 0.15;
    });
  }

  /* Chips ---------------------------------------------------------------- */

  function chipRest(i: number): THREE.Vector3 {
    const m = layout.metrics;
    return new THREE.Vector3(
      m.betCenter.x + rand(-0.014, 0.014),
      layout.chipRestY + i * layout.chipStep,
      m.betCenter.y + rand(-0.014, 0.014)
    );
  }

  function tossChips(delta: number) {
    const denoms = denomsFor(delta);
    const toss = glbClips.ChipToss;
    denoms.forEach((denom, n) => {
      if (betStack.length >= MAX_BET_CHIPS) return; // extra chips are implied
      const i = betStack.length;
      const rest = chipRest(i);
      const delay = n * 0.09;

      if (toss && glbChipTemplate && !reduced) {
        // Authored ChipToss, retargeted: the clip ends on the betting circle at
        // glb-space (0, 0.0305, 0.90) — a parent offset makes that end land on
        // this chip's stack slot.
        const chip = cloneGlbChip(denom);
        primeToClipStart(chip, toss, GLB_CHIP_NODE); // never hover mid-air
        const wrapper = new THREE.Group();
        wrapper.scale.setScalar(TABLE_SCALE);
        // The clip lands the chip on the circle at felt height; the wrapper's
        // y-offset (this chip's slot in the stack) eases in over the flight so
        // a tall stack's chips don't sail in high above the felt.
        const yOffset = rest.y - GLB_CHIP_CLIP_Y * TABLE_SCALE;
        wrapper.position.set(
          rest.x - GLB_BET_CENTER.x * TABLE_SCALE,
          0,
          rest.z - GLB_BET_CENTER.y * TABLE_SCALE
        );
        wrapper.userData.tossing = true;
        wrapper.add(chip);
        scene.add(wrapper);
        betStack.push(wrapper);
        const played = playClip(
          wrapper,
          toss,
          TOSS_SECONDS,
          delay,
          () => {
            // Snap: swap wrapper → bare chip at its exact rest pose so the
            // settle/payout clips keep driving a flat node.
            scene.remove(wrapper);
            wrapper.userData.tossing = false;
            const idx = betStack.indexOf(wrapper);
            if (idx === -1) return; // stack was swept mid-flight
            chip.position.copy(rest);
            chip.quaternion.identity();
            chip.scale.setScalar(TABLE_SCALE);
            scene.add(chip);
            betStack[idx] = chip;
            audio.play("chipToss");
          },
          "chip wrapper"
        );
        if (played) {
          tween(delay, TOSS_SECONDS, (e) => {
            wrapper.position.y = yOffset * e;
          });
          return;
        }
        scene.remove(wrapper);
        betStack.splice(betStack.indexOf(wrapper), 1);
      }

      // Procedural toss (also the reduced-motion snap path).
      const chip = buildChipMesh(denom);
      const from = new THREE.Vector3(
        layout.metrics.betCenter.x + 0.9,
        layout.metrics.top + 0.3,
        layout.metrics.maxZ + 0.7
      );
      const spin = rand(0, Math.PI * 2);
      chip.position.copy(from);
      chip.rotation.y = spin;
      scene.add(chip);
      betStack.push(chip);
      tween(
        delay,
        TOSS_SECONDS,
        (e, k) => {
          chip.position.x = from.x + (rest.x - from.x) * e;
          chip.position.z = from.z + (rest.z - from.z) * e;
          chip.position.y = from.y + (rest.y - from.y) * e + Math.sin(Math.PI * k) * 0.35;
          chip.rotation.y = spin + (1 - e) * 2.2;
          chip.rotation.x = (1 - e) * 0.5;
        },
        () => {
          chip.position.copy(rest);
          chip.rotation.x = 0;
          audio.play("chipToss");
        }
      );
    });
  }

  function clearBetStack() {
    for (const chip of betStack) scene.remove(chip);
    betStack.length = 0;
  }

  function clearTransients() {
    for (const chip of transientChips) scene.remove(chip);
    transientChips.length = 0;
  }

  /** Local position of a clip's first or last keyframe for `nodeName`. */
  function clipKeyLocal(
    clip: THREE.AnimationClip,
    nodeName: string,
    which: "first" | "last",
    out: THREE.Vector3
  ): THREE.Vector3 | null {
    for (const track of clip.tracks) {
      if (track.name !== `${nodeName}.position`) continue;
      const v = track.values;
      const n = v.length;
      if (which === "first") out.set(v[0], v[1], v[2]);
      else out.set(v[n - 3], v[n - 2], v[n - 1]);
      return out;
    }
    return null;
  }

  /**
   * Fly a chip from `worldStart` to `worldEnd` on an authored Chip7 clip, or a
   * plain slide when no clip is available.
   *
   * `anchor` picks which end of the authored curve is pinned exactly: "end" for
   * a payout (it must land beside the bet), "start" for a sweep (it must leave
   * from exactly where the chip is sitting). The authored delta matches the
   * measured table, so the free end lands where it should either way.
   */
  function flyChip(
    chip: THREE.Object3D,
    clip: THREE.AnimationClip | undefined,
    seconds: number,
    delay: number,
    worldStart: THREE.Vector3,
    worldEnd: THREE.Vector3,
    anchor: "start" | "end",
    onArrive: () => void
  ) {
    if (clip && glbChipTemplate && !reduced) {
      const pinWorld = anchor === "start" ? worldStart : worldEnd;
      const pinLocal = clipKeyLocal(
        clip,
        GLB_CHIP_NODE,
        anchor === "start" ? "first" : "last",
        _vB
      );
      if (pinLocal) {
        primeToClipStart(chip, clip, GLB_CHIP_NODE);
        chip.scale.setScalar(1); // the wrapper carries TABLE_SCALE
        const wrapper = new THREE.Group();
        wrapper.scale.setScalar(TABLE_SCALE);
        wrapper.position.set(
          pinWorld.x - pinLocal.x * TABLE_SCALE,
          pinWorld.y - pinLocal.y * TABLE_SCALE,
          pinWorld.z - pinLocal.z * TABLE_SCALE
        );
        wrapper.add(chip);
        scene.add(wrapper);
        transientChips.push(wrapper);
        const played = playClip(
          wrapper,
          clip,
          seconds,
          delay,
          () => {
            scene.remove(wrapper);
            const j = transientChips.indexOf(wrapper);
            if (j !== -1) transientChips.splice(j, 1);
            onArrive();
          },
          "chip wrapper"
        );
        if (played) return;
        // Bind failed — unwrap and slide instead.
        scene.remove(wrapper);
        const j = transientChips.indexOf(wrapper);
        if (j !== -1) transientChips.splice(j, 1);
        wrapper.remove(chip);
        chip.scale.setScalar(TABLE_SCALE);
        scene.add(chip);
      }
    }
    // Plain slide fallback: sink under the felt near the end, then vanish.
    chip.position.copy(worldStart);
    transientChips.push(chip);
    const finish = () => {
      const idx = transientChips.indexOf(chip);
      if (idx !== -1) transientChips.splice(idx, 1);
      onArrive();
    };
    tween(
      delay,
      seconds,
      (e) => {
        chip.position.x = worldStart.x + (worldEnd.x - worldStart.x) * e;
        chip.position.z = worldStart.z + (worldEnd.z - worldStart.z) * e;
        chip.position.y = worldStart.y + (worldEnd.y - worldStart.y) * e;
      },
      finish
    );
  }

  /* Chip rack (in-scene, clickable) --------------------------------------- */

  function disposeRack() {
    for (const stack of rackStacks) {
      scene.remove(stack.group);
      scene.remove(stack.hit);
      for (const m of stack.mats) m.dispose();
    }
    rackStacks.length = 0;
    hitMeshes.length = 0;
    if (betHit) {
      scene.remove(betHit);
      betHit = null;
    }
  }

  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  sharedDisposables.push(hitMat);

  function buildRack() {
    disposeRack();
    const m = layout.metrics;
    for (const slot of layout.rack) {
      const group = new THREE.Group();
      const chips: THREE.Object3D[] = [];
      const mats: THREE.MeshStandardMaterial[] = [];
      const baseColors: THREE.Color[] = [];
      // Private material cache per stack: hover/dim must stay local.
      const cache = new Map<string, THREE.Material>();
      for (let i = 0; i < RACK_STACK_HEIGHT; i++) {
        let chip: THREE.Object3D;
        if (glbChipTemplate) {
          // A private material cache: this stack owns and disposes its clones,
          // so hover/dim never drags the chips on the felt with it.
          chip = cloneGlbChip(slot.denom, cache);
          chip.position.set(0, 0, 0);
          chip.quaternion.identity();
          chip.scale.setScalar(TABLE_SCALE);
        } else {
          const stackMats = getChipMats(slot.denom).map((mat) => mat.clone());
          const mesh = new THREE.Mesh(chipGeo, stackMats);
          mesh.castShadow = true;
          chip = mesh;
          for (const mat of stackMats) {
            const std = mat as THREE.MeshStandardMaterial;
            std.emissive = new THREE.Color(GOLD_LIGHT);
            std.emissiveIntensity = 0;
            mats.push(std);
          }
        }
        chip.position.y = layout.chipRestY + i * layout.chipStep;
        group.add(chip);
        chips.push(chip);
      }
      if (glbChipTemplate) {
        for (const mat of cache.values()) mats.push(mat as THREE.MeshStandardMaterial);
      }
      for (const mat of mats) baseColors.push(mat.color.clone());

      group.position.set(slot.x, 0, slot.z);
      scene.add(group);

      // Generous invisible hit cylinder so phone taps land. 1.55x the chip is
      // as wide as it can get before adjacent stacks' targets overlap.
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.visible = false; // still raycastable — Raycaster ignores `visible`
      hit.scale.set(m.chipRadius * 1.55, 1, m.chipRadius * 1.55);
      hit.position.set(slot.x, m.top + 0.2, slot.z);
      scene.add(hit);

      const stack: RackStack = {
        denom: slot.denom,
        group,
        chips,
        mats,
        baseColors,
        hit,
        enabled: false,
        hovered: false,
        lift: 0,
      };
      hit.userData.target = { kind: "rack", stack } satisfies HitTarget;
      hitMeshes.push(hit);
      rackStacks.push(stack);
    }

    // The live bet stack is clickable too — clicking it clears the bet.
    const bh = new THREE.Mesh(hitGeo, hitMat);
    bh.visible = false;
    bh.scale.set(m.betRadius, 1, m.betRadius);
    bh.position.set(m.betCenter.x, m.top + 0.2, m.betCenter.y);
    bh.userData.target = { kind: "bet" } satisfies HitTarget;
    scene.add(bh);
    hitMeshes.push(bh);
    betHit = bh;
    refreshRackState();
  }

  function refreshRackState() {
    const betting = phase === "BETTING";
    for (const stack of rackStacks) {
      const enabled = betting && bankroll !== null && lastBet + stack.denom <= bankroll;
      stack.enabled = enabled;
      stack.mats.forEach((mat, i) => {
        const base = stack.baseColors[i];
        mat.color.copy(base);
        if (!enabled) {
          mat.color.multiplyScalar(0.32);
          mat.emissiveIntensity = 0;
        }
      });
      if (!enabled && stack.hovered) stack.hovered = false;
    }
  }

  function setHover(target: HitTarget | null) {
    const next =
      target && target.kind === "rack" && !target.stack.enabled
        ? null
        : target && target.kind === "bet" && !(phase === "BETTING" && lastBet > 0)
          ? null
          : target;
    if (next === hovered) return;
    if (hovered && hovered.kind === "rack") hovered.stack.hovered = false;
    hovered = next;
    if (hovered && hovered.kind === "rack") hovered.stack.hovered = true;
    renderer.domElement.style.cursor = hovered ? "pointer" : "";
  }

  /** Per-frame: the hovered stack's top chip lifts with a gold tick. */
  function stepRack(dt: number) {
    for (const stack of rackStacks) {
      const want = stack.hovered ? 1 : 0;
      const speed = reduced ? 1 : Math.min(1, dt * 12);
      stack.lift += (want - stack.lift) * speed;
      if (Math.abs(stack.lift - want) < 0.002) stack.lift = want;
      const top = stack.chips[stack.chips.length - 1];
      top.position.y = layout.chipRestY + (stack.chips.length - 1) * layout.chipStep + stack.lift * 0.03;
      const glow = stack.enabled ? stack.lift * 0.35 : 0;
      for (const mat of stack.mats) mat.emissiveIntensity = glow;
    }
  }

  /* ── Pointer interaction ──────────────────────────────────────────────── */

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();

  function pick(clientX: number, clientY: number): HitTarget | null {
    if (hitMeshes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    return hits.length ? ((hits[0].object.userData.target as HitTarget) ?? null) : null;
  }

  const onPointerMove = (ev: PointerEvent) => {
    if (phase !== "BETTING") {
      setHover(null);
      return;
    }
    setHover(pick(ev.clientX, ev.clientY));
  };
  const onPointerLeave = () => setHover(null);
  const onClick = (ev: MouseEvent) => {
    if (phase !== "BETTING") return;
    const target = pick(ev.clientX, ev.clientY);
    if (!target) return;
    if (target.kind === "bet") {
      if (lastBet > 0) onClearBet();
      return;
    }
    if (!target.stack.enabled) return;
    onPlaceBet(target.stack.denom);
  };
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("click", onClick);

  /* Settlement ------------------------------------------------------------ */

  function runSettle(outcome: Outcome) {
    const m = layout.metrics;
    const won = outcome === "win" || outcome === "blackjack";
    const stack = betStack.splice(0);

    // Chips still riding ChipToss are wrappers, not settled chips — leave them
    // alone. Their own snap sees the emptied betStack and tidies them away.
    const settledChips = stack.filter((chip) => chip.userData.tossing !== true);

    if (outcome === "lose") {
      // The house takes it — authored ChipSweep, circle → dealer tray.
      settledChips.forEach((chip, i) => {
        const from = chip.position.clone();
        flyChip(
          chip,
          glbClips.ChipSweep,
          SWEEP_SECONDS,
          0.15 + i * 0.05,
          from,
          m.payoutFrom,
          "start", // the sweep must leave from exactly where the chip sits
          () => scene.remove(chip)
        );
      });
    } else {
      // Win or push: the bet stays put. A win gets paid alongside it.
      for (const chip of settledChips) transientChips.push(chip);
    }

    if (won) {
      const denoms = denomsFor(outcome === "blackjack" ? lastBet * 1.5 : lastBet).slice(
        0,
        MAX_PAYOUT_CHIPS
      );
      const payout = glbClips.ChipPayout;
      denoms.forEach((denom, i) => {
        const chip = buildChipMesh(denom);
        const lane = (i % 3) - 1;
        // ChipPayout runs tray → betting circle; nudge each chip into a lane
        // beside the player's own stack so the pile reads as "paid".
        const end = new THREE.Vector3(
          m.betCenter.x + lane * (m.chipRadius * 2.3),
          layout.chipRestY + Math.floor(i / 3) * layout.chipStep,
          m.betCenter.y
        );
        chip.position.copy(m.payoutFrom);
        scene.add(chip);
        // Anchored on the END: the payout must land beside the player's stack.
        flyChip(chip, payout, PAYOUT_SECONDS, 0.18 + i * 0.07, m.payoutFrom, end, "end", () => {
          if (i === denoms.length - 1) audio.play("chipStack");
        });
      });
    }

    // Win glow: gold point-light pulse + a brief emissive tick on the
    // winning side's cards. The SETTLED banner itself stays DOM.
    if (outcome !== "push") {
      const winnerRow = won ? rows.player : rows.dealer;
      const peak = won ? 9 : 3.5;
      pulse.position.set(0, 1.15, won ? layout.playerZ : layout.dealerZ);
      tween(
        0.1,
        0.9,
        (_, k) => {
          const wave = Math.sin(Math.PI * k);
          pulse.intensity = wave * peak;
          for (const entry of winnerRow) {
            for (const mm of entry.mats) mm.emissiveIntensity = wave * (won ? 0.4 : 0.15);
          }
        },
        () => {
          pulse.intensity = 0;
          for (const entry of winnerRow) for (const mm of entry.mats) mm.emissiveIntensity = 0;
        }
      );
    }

    // A small camera nudge on a win — 2%, then smoothly back.
    if (won && !reduced) {
      tween(0.05, 0.4, (e) => {
        camNudge = e * 0.02;
      });
      tween(0.75, 0.9, (e) => {
        camNudge = 0.02 * (1 - e);
      });
    }
  }

  /** A face-down card drops into the shoe: the authored ShoeRefill. */
  function playShoeRefill() {
    audio.play("shuffle");
    const clip = glbClips.ShoeRefill;
    if (!clip || reduced || disposed) return;
    // ShoeRefill also drives the Shoe node (a constant hold) — keep only the
    // card tracks so the clip binds against a lone card wrapper.
    const cardTracks = clip.tracks.filter((t) => t.name.startsWith(`${GLB_CARD_NODE}.`));
    if (cardTracks.length === 0) return;
    const sub = new THREE.AnimationClip(`${clip.name}:card`, clip.duration, cardTracks);
    const { group, flip, mats } = buildCardMesh("back");
    flip.rotation.z = Math.PI;
    group.name = GLB_CARD_NODE;
    flip.scale.setScalar(layout.cardScale / TABLE_SCALE);
    primeToClipStart(group, sub, GLB_CARD_NODE);
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(TABLE_SCALE);
    wrapper.add(group);
    scene.add(wrapper);
    const cleanup = () => {
      scene.remove(wrapper);
      for (const m of mats) m.dispose();
    };
    if (!playClip(wrapper, sub, REFILL_SECONDS, 0, cleanup, "refill wrapper")) cleanup();
  }

  /* ── Sync: diff incoming state → animations ───────────────────────────── */

  function syncRow(row: "player" | "dealer", hand: Card[], holeIdx: number, delays: number[]) {
    if (hand.length < rows[row].length) clearRow(row); // new round swept the table
    let added = 0;
    for (let i = rows[row].length; i < hand.length; i++) {
      addCard(row, hand[i], i === holeIdx, delays[added] ?? 0);
      added++;
    }
  }

  function sync(p: SyncProps) {
    reduced = p.reducedMotion;
    phase = p.phase;
    bankroll = p.bankroll;
    onPlaceBet = p.onPlaceBet;
    onClearBet = p.onClearBet;

    if (lastShuffleSeq === -1) lastShuffleSeq = p.shuffleSeq;
    else if (p.shuffleSeq !== lastShuffleSeq) {
      lastShuffleSeq = p.shuffleSeq;
      playShoeRefill();
    }

    // Fresh two-card deal? Interleave the stagger like a live dealer:
    // player, dealer, player, dealer.
    const freshDeal =
      rows.player.length === 0 &&
      rows.dealer.length === 0 &&
      p.playerHand.length === 2 &&
      p.dealerHand.length === 2;
    if (p.playerHand.length < rows.player.length || p.dealerHand.length < rows.dealer.length) {
      clearRow("player");
      clearRow("dealer");
      clearTransients();
    }
    if (freshDeal) clearTransients();
    const s = DEAL_STAGGER;
    syncRow("player", p.playerHand, -1, freshDeal ? [0, 2 * s] : [0]);
    syncRow("dealer", p.dealerHand, p.holeCardHidden ? 1 : -1, freshDeal ? [s, 3 * s] : [0]);

    // Hole-card reveal.
    if (!p.holeCardHidden) {
      const hole = rows.dealer[1];
      if (hole && hole.faceDown) flipHole(hole);
    }

    // Bet chips: toss on increase, sweep on clear/decrease.
    if (p.betChips > lastBet && (p.phase === "BETTING" || p.phase === "PLAYER")) {
      const delta = p.betChips - lastBet;
      lastBet = p.betChips;
      tossChips(delta); // covers per-click adds AND double-down
    } else if (p.betChips < lastBet) {
      lastBet = p.betChips;
      clearBetStack();
      clearTransients();
    } else {
      lastBet = p.betChips;
    }

    refreshRackState();
    if (phase !== "BETTING") setHover(null);

    // Settlement animations fire exactly once per SETTLED.
    if (p.phase === "SETTLED" && p.outcome && !settledHandled) {
      settledHandled = true;
      runSettle(p.outcome);
    } else if (p.phase !== "SETTLED") {
      settledHandled = false;
    }
  }

  /* ── Render loop (paused while document.hidden) ───────────────────────── */

  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05); // clamp tab-switch jumps
    now += dt;
    stepTweens();
    for (const mixer of activeMixers) mixer.update(dt); // glb clip instances
    stepRack(dt);

    // Betting circle breathes while the player is deciding.
    ringMat.opacity =
      phase === "BETTING" && !reduced ? 0.26 + 0.16 * (0.5 + 0.5 * Math.sin(now * 2.1)) : 0.28;

    if (reduced) {
      camera.position.copy(camBase);
    } else {
      // Intro push-in, then a subtle slow sway (≈ ±0.5°) so it feels alive.
      const pull = 1 + camIntro * 0.22 - camNudge;
      camera.position.set(
        camBase.x * pull + Math.sin(now * 0.32) * 0.1,
        camBase.y * pull + camIntro * 0.8 + Math.sin(now * 0.21 + 1.3) * 0.045,
        camBase.z * pull
      );
    }
    camera.lookAt(CAM_TARGET);
    renderer.render(scene, camera);
  };
  const start = () => {
    if (running) return;
    running = true;
    clock.getDelta(); // swallow the paused interval
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  /* ── Resize (ResizeObserver on the mount div) ─────────────────────────── */

  const applyLayoutSize = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    const aspect = w / h;
    camera.aspect = aspect;
    // Narrow viewports pull the camera back so the whole table still fits.
    const f = THREE.MathUtils.clamp(1.5 / aspect, 1, 1.9);
    camBase.copy(CAM_BASE).multiplyScalar(1 + (f - 1) * 0.55);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  const observer = new ResizeObserver(applyLayoutSize);
  observer.observe(mount);
  applyLayoutSize();
  applyLayout(layout);
  start();

  /* ── Async asset loads (procedural scene already rendering) ────────────── */

  try {
    new THREE.TextureLoader().load(
      ATLAS_URL,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        adoptAtlas(tex);
      },
      undefined,
      () => {
        warnOnce("atlas", `could not load ${ATLAS_URL} — using painted card faces.`);
      }
    );
  } catch {
    warnOnce("atlas", `could not load ${ATLAS_URL} — using painted card faces.`);
  }

  try {
    new GLTFLoader().load(
      GLB_URL,
      (gltf) => {
        if (disposed) return;
        try {
          adoptGlb(gltf);
        } catch (err) {
          warnOnce(
            "glb",
            `${GLB_URL} loaded but could not be adopted (${
              err instanceof Error ? err.message : String(err)
            }) — keeping the procedural table.`
          );
        }
      },
      undefined,
      () => {
        warnOnce("glb", `could not load ${GLB_URL} — keeping the procedural table.`);
      }
    );
  } catch {
    warnOnce("glb", `could not load ${GLB_URL} — keeping the procedural table.`);
  }

  /* ── Teardown: dispose EVERYTHING ─────────────────────────────────────── */

  function dispose() {
    disposed = true; // clearRow must remove instantly, never play CardDiscard
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    renderer.domElement.removeEventListener("click", onClick);
    observer.disconnect();
    tweens.length = 0;
    for (const mixer of activeMixers) mixer.stopAllAction();
    activeMixers.clear();
    clearRow("player");
    clearRow("dealer");
    for (const entry of discarding) {
      scene.remove(entry.group);
      for (const m of entry.mats) m.dispose();
    }
    discarding.clear();
    clearBetStack();
    clearTransients();
    disposeRack();
    if (glbEnv) scene.remove(glbEnv);
    glbEnv = null;
    glbChipTemplate = null;
    glbClips = {};
    for (const d of glbDisposables) d.dispose();
    glbDisposables.length = 0;
    glbChipMats.clear();
    for (const d of sharedDisposables) d.dispose();
    for (const tex of texCache.values()) tex.dispose();
    texCache.clear();
    chipMats.clear();
    for (const tex of atlasCells.values()) tex.dispose();
    atlasCells.clear();
    atlas?.dispose();
    atlas = null;
    scene.environment = null;
    envRT.dispose();
    pmrem.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
  }

  return { sync, dispose };
}

/* ── React shell (three.js only ever runs inside useEffect) ──────────────── */

export default function TableScene({
  playerHand,
  dealerHand,
  holeCardHidden,
  phase,
  betChips,
  bankroll,
  shuffleSeq,
  outcome,
  reducedMotion,
  onPlaceBet,
  onClearBet,
  onFallback,
}: TableSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<Controller | null>(null);
  const fallbackRef = useRef(onFallback);

  useEffect(() => {
    fallbackRef.current = onFallback;
  }, [onFallback]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let ctrl: Controller;
    try {
      ctrl = createController(mount);
    } catch {
      // No WebGL (blocked context, headless, ancient GPU) — DOM cards instead.
      fallbackRef.current();
      return undefined;
    }
    ctrlRef.current = ctrl;
    return () => {
      ctrlRef.current = null;
      ctrl.dispose();
    };
  }, []);

  useEffect(() => {
    ctrlRef.current?.sync({
      playerHand,
      dealerHand,
      holeCardHidden,
      phase,
      betChips,
      bankroll,
      shuffleSeq,
      outcome,
      reducedMotion,
      onPlaceBet,
      onClearBet,
    });
  }, [
    playerHand,
    dealerHand,
    holeCardHidden,
    phase,
    betChips,
    bankroll,
    shuffleSeq,
    outcome,
    reducedMotion,
    onPlaceBet,
    onClearBet,
  ]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} aria-hidden />;
}
