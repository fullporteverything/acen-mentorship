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

/** Denominations in the in-scene rack, nearest the betting circle → outward. */
const RACK_DENOMS = [25, 100, 500] as const;
const RACK_STACK_HEIGHT = 4; // chips drawn per rack stack

/* ── The Blender glb contract (public/brand/table-assets.glb) ────────────── */

const GLB_URL = "/brand/table-assets.glb";
/** The authored table's own footprint, in glb units (x 6.0 × z 3.5). */
const AUTHORED_W = 6.0;
const AUTHORED_D = 3.5;
/**
 * World scale applied to the whole glb.
 *
 * Raised from 1.267 (the old "match the procedural footprint" value): the
 * PLAYABLE band is fixed in table-relative terms — it runs from the front lip
 * of the dealer's chip-tray pocket (glb z −0.48) to the back of the authored
 * betting circle (glb z +0.56), i.e. 1.04 of the table's 2.98 felt depth. Two
 * full card rows plus their clearances have to live inside it, so the CARD
 * size relative to the table is capped at ~0.41 glb units of depth. At the old
 * scale that forced cardScale ≈ 0.50, below the readable floor; at 1.9 the
 * solver lands on ≈ 0.75 with every clearance comfortably positive. The owner
 * signed off on a bigger table, and the camera below is re-framed for it.
 */
const TABLE_SCALE = 1.9;

/* ── World dimensions (world units = glb units × TABLE_SCALE) ────────────── */

const TABLE_W = AUTHORED_W * TABLE_SCALE;
const TABLE_D = AUTHORED_D * TABLE_SCALE;
const CARD_W = 0.72;
const CARD_H = 1.04;
/** Half the procedural card's visual thickness (face/back plane offset). */
const CARD_HALF_T = 0.008;
const CARD_GAP = 0.44; // fan overlap step at full size
/** Procedural chip metrics — sized to the authored Chip7 (r 0.16, h 0.045). */
const CHIP_R = 0.16 * TABLE_SCALE;
const CHIP_H = 0.045 * TABLE_SCALE;
/** Node / clip names inside the glb (verified author contract). */
const GLB_CARD_NODE = "Card7S";
const GLB_CHIP_NODE = "Chip7";
const GLB_SHOE_NODE = "Shoe";
/** The 5-seat table variant ships in the same glb for future multiplayer. It
    is geometry only — never shown, and never measured (see adoptGlb). */
const GLB_TABLE5_NODE = "Table5";
/** The dealer: an armature ("DealerRig") holding a Group of SkinnedMeshes. */
const GLB_DEALER_NODE = "Dealer";
const GLB_DEALER_RIG = "DealerRig";
const GLB_ENV_NODES = ["Table", "Shoe", "ChipTray", "DiscardTray"] as const;
/** Material names on the authored Table mesh (one sub-mesh per material). */
const MAT_FELT = "S7_Felt";
const MAT_FELT_PRINT = "S7_FeltPrint";
/** The padded rail tube AND the table body slab share this material. */
const MAT_RAIL = "S7_Rail";
/**
 * Shoe's authored REST pose — the end of TableIntro. Its node transform is
 * the intro's START pose, which parks it off the table edge, so the shoe must
 * be moved here (or walked here by TableIntro) or cards deal from thin air.
 *
 * This is the ONE authored constant left, and even it is overwritten at load
 * time from TableIntro's last Shoe keyframe (see adoptGlb) — it is only the
 * value used if that clip is missing.
 */
const GLB_SHOE_REST = new THREE.Vector3(1.92, 0.19353486, -1.1);
/** Betting circle in authored table space (matches ChipToss' final key). */
const GLB_BET_CENTER = new THREE.Vector2(0, 0.9);
const GLB_BET_RADIUS = 0.34;

/* ── The dealer (glb clips on the DealerRig bones) ───────────────────────── */

const DEALER_IDLE = "DealerIdle";
const DEALER_DEAL = "DealerDeal";
const DEALER_FLIP = "DealerFlip";
const DEALER_SWEEP = "DealerSweep";
/** Cross-fade between the idle loop and a one-shot, seconds. */
const DEALER_FADE = 0.26;

/* ── The shoe's visible deck of face-down cards ──────────────────────────── */

/** Cards drawn in the stack when the shoe is full. */
const DECK_CARDS = 18;
/** Never thin below this — a shoe that looks empty mid-shoe reads as a bug. */
const DECK_MIN_CARDS = 4;
/** Stack step, in CARD-LOCAL units (the deck group carries the card scale). */
const DECK_STEP = 0.0075;

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
const ROW_HALF_SPAN_CAP = 1.46 * TABLE_SCALE;

/* ── Layout clearances (glb units × TABLE_SCALE, so the table can re-scale) ─ */

/** Clear felt every card / chip / prop keeps to the rail and the tray pocket. */
const EDGE_MARGIN = 0.055 * TABLE_SCALE;
/** Extra clearance the dealer row keeps from the chip-tray pocket. */
const TRAY_GAP = 0.09 * TABLE_SCALE;
/** Clearance between the dealer row and the player row. */
const ROW_GAP = 0.075 * TABLE_SCALE;
/** Gap between adjacent rack stacks, edge to edge. */
const RACK_GAP = 0.055 * TABLE_SCALE;
/** Gap between the betting circle and the nearest rack stack / the martini. */
const CIRCLE_GAP = 0.1 * TABLE_SCALE;
/**
 * How far out toward the front rail the rack and the martini sit, as a
 * fraction of the room between the player's card row and the rail. 1 would
 * pin them against the rail (correct, but they crowd the bottom of frame).
 */
const FRONT_SEAT = 0.62;

/* ── The martini, a 3D prop on the felt (glb units, scaled by TABLE_SCALE) ── */

/** localStorage key — shared with the retired DOM martini so sips carry over. */
const MARTINI_KEY = "suite7:martini";
const MARTINI_SIPS = 5;
/** Bowl rim radius: the prop's footprint for clearance purposes. */
const MARTINI_RIM_R = 0.2;
/** Bowl interior: apex y → rim y (the liquid cone lives between them). */
const MARTINI_APEX_Y = 0.25;
const MARTINI_RIM_Y = 0.436;
const MARTINI_LIQUID_R = 0.188;
const SIP_SECONDS = 0.5;
const POUR_SECONDS = 0.95;

/* ── Camera ──────────────────────────────────────────────────────────────── */

/**
 * Framing: "the player's seat at a real table, with the dealer across from
 * you". Solved numerically against the measured world bounds rather than
 * eyeballed — at CAM_REF_ASPECT every one of the table silhouette, both card
 * rows, the rack, the betting circle, the martini, the shoe, both trays and
 * the DEALER projects inside |ndc| <= 0.92, with the dealer's head at 0.895
 * (headroom above the back rail, visible from the waist up) and the table's
 * outer rails at 0.920 — a real margin, not edge-to-edge.
 *
 * The previous framing (0, 4.3, 6.9) put the table's rails at |ndc.x| = 1.68,
 * i.e. two thirds of the table's width was off-screen on each side, which is
 * what the owner was seeing as "a bit close".
 */
const CAM_BASE = new THREE.Vector3(0, 7.25, 11.63);
const CAM_TARGET = new THREE.Vector3(0, -0.2, -0.75);
const CAM_FOV = 36;
/** The aspect the framing above is solved at. */
const CAM_REF_ASPECT = 1.78;
/** Narrower viewports pull straight back by REF/aspect, up to this much. */
const CAM_PULL_CAP = 2.1;

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

/* ── The playable surface: felt polygon, rail overhang, obstacles ─────────── */

/** A 2D ring in the XZ plane (Vector2.x = world x, Vector2.y = world z). */
type Ring = THREE.Vector2[];

/** An axis-aligned XZ footprint a card / chip must not land on. */
interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function pointInRing(ring: Ring, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Unsigned distance from (x,z) to the ring's outline. */
function distToRing(ring: Ring, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const len = dx * dx + dz * dz;
    let t = len > 0 ? ((x - a.x) * dx + (z - a.y) * dz) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = x - (a.x + t * dx);
    const pz = z - (a.y + t * dz);
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Signed distance outside an obstacle (negative while inside it). */
function obstacleGap(o: Obstacle, x: number, z: number): number {
  const dx = Math.max(o.minX - x, 0, x - o.maxX);
  const dz = Math.max(o.minZ - z, 0, z - o.maxZ);
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
  return -Math.min(x - o.minX, o.maxX - x, z - o.minZ, o.maxZ - z);
}

/** A rounded-rectangle ring — the procedural fallback's stand-in felt. */
function roundedRectRing(halfX: number, halfZ: number, r: number, seg = 6): Ring {
  const ring: Ring = [];
  const corners: [number, number, number][] = [
    [halfX - r, halfZ - r, 0],
    [-(halfX - r), halfZ - r, Math.PI / 2],
    [-(halfX - r), -(halfZ - r), Math.PI],
    [halfX - r, -(halfZ - r), -Math.PI / 2],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      ring.push(new THREE.Vector2(cx + r * Math.cos(a), cz + r * Math.sin(a)));
    }
  }
  return ring;
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
  /**
   * The felt's actual TOP-FACE outline — not its bounding box. The felt is a
   * half-moon: at x = 0 it reaches z = +1.49·scale, but at |x| = 2.4·scale it
   * has already curved back past z = 0. Treating the bbox as playable is what
   * put the chip rack on the rail.
   */
  feltRing: Ring;
  /** Holes cut in the felt — the recessed chip-tray pocket. */
  feltHoles: Ring[];
  /**
   * How far the padded rail tube overhangs the felt outline, measured off the
   * rail mesh itself (every S7_Rail vertex above the felt surface, tested
   * against the felt outline). The playable surface is the felt ring pulled
   * in by exactly this much.
   */
  railInset: number;
  /** Player-side edge of the dealer chip tray — the dealer row must clear it. */
  trayFrontZ: number;
  /** Player-side edge of the felt's tray POCKET (further forward than the tray). */
  pocketFrontZ: number;
  /** Raised props on the felt (trays, shoe) a card row must not overlap. */
  obstacles: Obstacle[];
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
  /** Where swept cards go — the measured DiscardTray, for the clip-less arc. */
  discardTo: THREE.Vector3;
}

/**
 * Clear felt in every direction around (x, z): the distance to the rail's
 * inner surface, to the tray pocket, and to any raised prop — whichever is
 * nearest. Negative means the point is already on the rail, in the pocket or
 * under a prop. THIS, not the felt bounding box, is the playable test.
 */
function surfaceClearance(m: FeltMetrics, x: number, z: number): number {
  const dRing = distToRing(m.feltRing, x, z);
  if (!pointInRing(m.feltRing, x, z)) return -dRing - m.railInset;
  let c = dRing - m.railInset;
  for (const hole of m.feltHoles) {
    const d = distToRing(hole, x, z);
    const signed = pointInRing(hole, x, z) ? -d : d;
    if (signed < c) c = signed;
  }
  for (const o of m.obstacles) {
    const g = obstacleGap(o, x, z);
    if (g < c) c = g;
  }
  return c;
}

/** True when a disc of `radius` centred on (x,z) sits clear of everything. */
function discFits(m: FeltMetrics, x: number, z: number, radius: number): boolean {
  return surfaceClearance(m, x, z) >= radius + EDGE_MARGIN;
}

/** The widest half-span a row of `cardW × cardH` cards may occupy at `z`. */
function solveRowHalfSpan(
  m: FeltMetrics,
  z: number,
  cardW: number,
  cardH: number,
  cap: number
): number {
  const step = 0.02;
  const probes = [-cardH / 2, 0, cardH / 2];
  let h = 0;
  while (h + step <= cap) {
    const next = h + step;
    let ok = true;
    for (const sx of [-1, 1]) {
      for (const dz of probes) {
        if (surfaceClearance(m, sx * (next + cardW / 2), z + dz) < EDGE_MARGIN) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) break;
    h = next;
  }
  return h;
}

/** Walk out toward the front rail from `from` while a `radius` disc still fits. */
function seatTowardRail(m: FeltMetrics, x: number, from: number, radius: number): number {
  const step = 0.02;
  let z = from;
  let best = from;
  const limit = from + m.maxZ - m.minZ;
  while (z <= limit) {
    if (!discFits(m, x, z, radius)) break;
    best = z;
    z += step;
  }
  return best;
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
  /** Where the 3D martini glass stands, on the player's right. */
  martini: { x: number; z: number; scale: number };
}

/** Procedural table metrics — used until (or unless) the glb lands. */
function proceduralMetrics(): FeltMetrics {
  const halfX = 2.74 * TABLE_SCALE;
  const halfZ = 1.49 * TABLE_SCALE;
  return {
    minX: -halfX,
    maxX: halfX,
    minZ: -halfZ,
    maxZ: halfZ,
    top: 0.008 * TABLE_SCALE,
    // Stand-in outline + rail overhang in the authored table's proportions, so
    // the pre-glb layout is already close to the measured one.
    feltRing: roundedRectRing(halfX, halfZ, 0.9 * TABLE_SCALE),
    feltHoles: [],
    railInset: 0.03 * TABLE_SCALE,
    trayFrontZ: -0.506 * TABLE_SCALE,
    pocketFrontZ: -0.48 * TABLE_SCALE,
    obstacles: [],
    rowHalfSpan: ROW_HALF_SPAN_CAP,
    betCenter: new THREE.Vector2(
      GLB_BET_CENTER.x * TABLE_SCALE,
      GLB_BET_CENTER.y * TABLE_SCALE
    ),
    betRadius: GLB_BET_RADIUS * TABLE_SCALE,
    chipRadius: CHIP_R,
    chipHeight: CHIP_H,
    shoeMouth: new THREE.Vector3(1.92, 0.42, -1.1).multiplyScalar(TABLE_SCALE),
    payoutFrom: new THREE.Vector3(0, 0.03, -0.72).multiplyScalar(TABLE_SCALE),
    discardTo: new THREE.Vector3(-1.95, 0.04, -1.15).multiplyScalar(TABLE_SCALE),
  };
}

/**
 * Turn measured table metrics into concrete row / rack / prop placement.
 *
 * The rules, in order of priority:
 *   1. every card, chip and prop keeps EDGE_MARGIN of clear felt to the rail's
 *      INNER surface — the felt outline pulled in by the measured rail
 *      overhang — and to the tray pocket and the raised props;
 *   2. the dealer row clears the dealer's chip-tray pocket;
 *   3. the player row sits BEHIND the betting circle (dealer-ward), the way a
 *      real table lays out — never on top of the chips;
 *   4. if 1–3 cannot all hold at full card size, the CARDS shrink and the fan
 *      tightens. The rows never move outward.
 */
function solveLayout(m: FeltMetrics): Layout {
  // The playable z-band: from the front lip of the tray pocket to the back of
  // the betting circle. Everything else follows from it.
  const backLimit = Math.max(m.trayFrontZ, m.pocketFrontZ) + TRAY_GAP;
  const frontLimit = m.betCenter.y - m.betRadius - EDGE_MARGIN;
  const band = Math.max(0.25, frontLimit - backLimit);

  const cardScale = THREE.MathUtils.clamp((band - ROW_GAP) / 2 / CARD_H, 0.42, 1);
  const cardH = CARD_H * cardScale;
  const cardW = CARD_W * cardScale;

  const dealerZ = backLimit + cardH / 2;
  const playerZ = frontLimit - cardH / 2;

  // Card rest height: the card's BOTTOM plane sits just above the felt.
  const cardRestY = m.top + CARD_HALF_T * cardScale + 0.005;
  const chipRestY = m.top + m.chipHeight / 2 + 0.002;

  const cap = Math.min(ROW_HALF_SPAN_CAP, m.rowHalfSpan);
  const rowHalfSpan = Math.max(
    cardW,
    Math.min(
      cap,
      solveRowHalfSpan(m, dealerZ, cardW, cardH, cap),
      solveRowHalfSpan(m, playerZ, cardW, cardH, cap)
    )
  );

  // The player's own furniture lives between the card row and the front rail:
  // the chip rack to their left, the martini to their right.
  const rowFront = playerZ + cardH / 2;
  const chipR = m.chipRadius;
  const rackStep = chipR * 2 + RACK_GAP;
  const rackNear = rowFront + chipR + EDGE_MARGIN;
  const rack = RACK_DENOMS.map((denom, i) => {
    const x = m.betCenter.x - (m.betRadius + chipR + CIRCLE_GAP + i * rackStep);
    const far = seatTowardRail(m, x, rackNear, chipR);
    return { denom, x, z: rackNear + (far - rackNear) * FRONT_SEAT };
  });

  const martiniScale = TABLE_SCALE;
  const martiniR = MARTINI_RIM_R * martiniScale;
  const martiniX = m.betCenter.x + m.betRadius + martiniR + CIRCLE_GAP;
  const martiniNear = rowFront + martiniR + EDGE_MARGIN;
  const martiniFar = seatTowardRail(m, martiniX, martiniNear, martiniR);
  const martini = {
    x: martiniX,
    z: martiniNear + (martiniFar - martiniNear) * FRONT_SEAT,
    scale: martiniScale,
  };

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
    rowHalfSpan,
    chipRestY,
    chipStep: m.chipHeight,
    rack,
    martini,
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

type HitTarget =
  | { kind: "rack"; stack: RackStack }
  | { kind: "bet" }
  | { kind: "martini" };

const SUIT_KEYS: Record<Suit, string> = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };

/** Throws if WebGL is unavailable — the caller falls back to DOM cards. */
function createController(mount: HTMLDivElement): Controller {
  const audio = tableAudio();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 80);
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
    // The shoe's deck is drawn from the same BACK cell.
    if (deck) {
      const mat = deck.cards[0]?.material as THREE.MeshStandardMaterial | undefined;
      if (mat) {
        mat.map = backTexture();
        mat.needsUpdate = true;
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
  shoe.position.set(1.92 * TABLE_SCALE, 0.2 * TABLE_SCALE, -1.1 * TABLE_SCALE);
  shoe.scale.setScalar(TABLE_SCALE);
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

  /* Distances (and, for the inverse-square lamps, intensities) follow
     TABLE_SCALE so re-scaling the table keeps the same lighting. */
  const LS = TABLE_SCALE / 1.2667; // light scale relative to the original rig

  const ambient = new THREE.AmbientLight(0x8a7550, 0.55);
  const key = new THREE.DirectionalLight(0xffe9c4, 1.35);
  key.position.set(2.2 * LS, 7.2 * LS, 4.2 * LS);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.024 * LS;
  key.shadow.radius = 3;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -4.3 * LS;
  shadowCam.right = 4.3 * LS;
  shadowCam.top = 3.0 * LS;
  shadowCam.bottom = -3.0 * LS;
  shadowCam.near = 1.5 * LS;
  shadowCam.far = 20 * LS;
  shadowCam.updateProjectionMatrix();

  const rim = new THREE.DirectionalLight(0xe3c071, 0.42);
  rim.position.set(-3.2 * LS, 3 * LS, -5 * LS);

  /* The house lamp: a warm cone that pools on the felt and dies at the rails.
     Decay is 2, so the intensity has to grow with the square of the throw. */
  const spot = new THREE.SpotLight(0xffdfae, 95 * LS * LS, 20 * LS, 0.62, 0.92, 2);
  spot.position.set(0, 6.4 * LS, 0.5 * LS);
  spot.target.position.set(0, 0, -0.2 * LS);

  const pulse = new THREE.PointLight(0xf7e8ac, 0, 6 * LS, 2);
  pulse.position.set(0, 1.15 * LS, 0);

  /* Dealer fill. The house lamp pools on the FELT and dies at the rails, which
     leaves the man standing behind them as a silhouette. This is a short-throw
     inverse-square lamp aimed at his chest — it shapes the jacket and shirt and
     is spent long before it reaches the player's half of the table. Placed and
     lit in adoptDealer(), off until then. */
  const dealerFill = new THREE.PointLight(0xffe6bd, 0, 1, 2);
  scene.add(ambient, key, rim, spot, spot.target, pulse, dealerFill);

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
  /* The dealer: the loaded SkinnedMesh rig itself — never cloned, so the
     skeleton binding the glb set up survives untouched. */
  let dealerRig: THREE.Object3D | null = null;
  let dealerMixer: THREE.AnimationMixer | null = null;
  let dealerIdleAction: THREE.AnimationAction | null = null;
  /** One-shots currently weighted onto the rig, newest last. */
  interface DealerShot {
    action: THREE.AnimationAction;
    weight: number;
    target: number;
    /** Bumped when the same reach is re-triggered, so a stale hand-back is
        ignored and the arm is not dropped mid-swing. */
    seq: number;
  }
  const dealerShots: DealerShot[] = [];
  /** Cloned clips, so overlapping reaches get independent actions. */
  const dealerVariants = new Map<string, THREE.AnimationClip[]>();
  let dealerSeq = 0;
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

  /**
   * Put every node a clip drives on that clip's FIRST keyframe, so nothing is
   * ever parked elsewhere while a delayed action waits to start. (The glb's
   * node rest poses ARE the TableIntro start poses — the Shoe rests off the
   * table edge, Chip7 rests a metre up — which is what used to make chips
   * hover in mid-air before their toss began. Do not remove this.)
   *
   * `root` is matched by name too, so a bare retarget node (a card group named
   * "Card7S") primes exactly as a whole rig does.
   */
  function primeToClipStart(root: THREE.Object3D, clip: THREE.AnimationClip) {
    for (const track of clip.tracks) {
      const dot = track.name.indexOf(".");
      if (dot === -1) continue;
      const nodeName = track.name.slice(0, dot);
      const node = root.name === nodeName ? root : root.getObjectByName(nodeName);
      if (!node) continue;
      const prop = track.name.slice(dot + 1);
      const v = track.values;
      if (prop === "position") node.position.set(v[0], v[1], v[2]);
      else if (prop === "quaternion") node.quaternion.set(v[0], v[1], v[2], v[3]);
      else if (prop === "scale") node.scale.set(v[0], v[1], v[2]);
    }
  }

  /* ── Scale-independent retargeting ────────────────────────────────────── */

  /**
   * THE ANCHORING CONTRACT.
   *
   * Every authored clip is animated in TABLE units and is retargeted by
   * parenting the animated node under a Group scaled by TABLE_SCALE. Where
   * that Group has to sit is derived ENTIRELY from the clip's own first/last
   * keyframes, read here at load time — never from a hand-copied constant.
   *
   * That is the fix for the class of bug this file has now hit twice: the
   * authored rest heights (a laid card at y 0.020, a settled chip at 0.0305)
   * and the authored betting-circle centre used to live as literals up top, so
   * changing TABLE_SCALE — or re-exporting the glb — silently desynced the
   * wrapper offset from the curve and the motion stopped landing where the
   * solved layout said it should. Reading the track values means a future
   * TABLE_SCALE change, or a re-authored clip, can never desync it again.
   */
  interface ClipAnchor {
    /** Local position of the node's first keyframe (authored table units). */
    first: THREE.Vector3;
    /** Local position of the node's last keyframe. */
    last: THREE.Vector3;
    /** Orientation at the first keyframe. */
    firstQuat: THREE.Quaternion;
    /** Largest positional travel across the clip, authored units. */
    travel: number;
    /** Largest rotation across the clip, radians. */
    turn: number;
  }
  const anchorCache = new Map<string, ClipAnchor | null>();

  /** First/last keyframes of `nodeName` in `clip`, cached. Null if untracked. */
  function clipAnchor(clip: THREE.AnimationClip, nodeName: string): ClipAnchor | null {
    const key = `${clip.name}|${nodeName}`;
    const hit = anchorCache.get(key);
    if (hit !== undefined) return hit;
    let anchor: ClipAnchor | null = null;
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    for (const track of clip.tracks) {
      const dot = track.name.indexOf(".");
      if (dot === -1 || track.name.slice(0, dot) !== nodeName) continue;
      const prop = track.name.slice(dot + 1);
      const v = track.values;
      const n = v.length;
      if (!anchor) {
        anchor = {
          first: new THREE.Vector3(),
          last: new THREE.Vector3(),
          firstQuat: new THREE.Quaternion(),
          travel: 0,
          turn: 0,
        };
      }
      if (prop === "position") {
        anchor.first.set(v[0], v[1], v[2]);
        anchor.last.set(v[n - 3], v[n - 2], v[n - 1]);
        // Max excursion from the first key — a clip that only holds still has
        // no motion to show, whatever its start and end happen to be.
        for (let i = 0; i + 2 < n; i += 3) {
          const d = Math.hypot(v[i] - v[0], v[i + 1] - v[1], v[i + 2] - v[2]);
          if (d > anchor.travel) anchor.travel = d;
        }
      } else if (prop === "quaternion") {
        anchor.firstQuat.set(v[0], v[1], v[2], v[3]);
        qa.set(v[0], v[1], v[2], v[3]);
        for (let i = 0; i + 3 < n; i += 4) {
          qb.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
          const a = qa.angleTo(qb);
          if (a > anchor.turn) anchor.turn = a;
        }
      }
    }
    anchorCache.set(key, anchor);
    return anchor;
  }

  /** World-space offset that makes `nodeName`'s LAST keyframe land on `world`. */
  function anchorEnd(
    clip: THREE.AnimationClip,
    nodeName: string,
    world: THREE.Vector3,
    out: THREE.Vector3
  ): THREE.Vector3 {
    const a = clipAnchor(clip, nodeName);
    out.copy(world);
    if (a) out.addScaledVector(a.last, -TABLE_SCALE);
    return out;
  }

  /** World-space offset that makes `nodeName`'s FIRST keyframe land on `world`. */
  function anchorStart(
    clip: THREE.AnimationClip,
    nodeName: string,
    world: THREE.Vector3,
    out: THREE.Vector3
  ): THREE.Vector3 {
    const a = clipAnchor(clip, nodeName);
    out.copy(world);
    if (a) out.addScaledVector(a.first, -TABLE_SCALE);
    return out;
  }

  /** The pose a retargeted node must be snapped to at the end of `clip`. */
  function restPose(clip: THREE.AnimationClip, nodeName: string, node: THREE.Object3D) {
    const a = clipAnchor(clip, nodeName);
    if (a) node.position.copy(a.last);
    else node.position.set(0, 0, 0);
    node.quaternion.identity();
  }

  /**
   * MOTION GUARD. A clip can bind perfectly and still show nothing: every
   * track constant, or a duration/timeScale that works out to zero. That looks
   * exactly like a card popping into existence, so a clip with no motion is
   * refused here and routed to the procedural (always-animated) path.
   */
  function hasMotion(clip: THREE.AnimationClip, seconds: number, label: string): boolean {
    if (!(clip.duration > 0) || !Number.isFinite(clip.duration)) {
      warnOnce(
        `motion:${clip.name}`,
        `clip "${clip.name}" has a ${clip.duration} duration — no motion to play ` +
          `on the ${label}; using the procedural fallback.`
      );
      return false;
    }
    const scale = clip.duration / Math.max(0.05, seconds);
    if (!Number.isFinite(scale) || scale <= 0) {
      warnOnce(
        `motion:${clip.name}`,
        `clip "${clip.name}" retimes to a non-finite timeScale (${scale}) on the ` +
          `${label}; using the procedural fallback.`
      );
      return false;
    }
    // Any track that actually moves or turns is enough.
    const nodes = new Set<string>();
    for (const track of clip.tracks) {
      const dot = track.name.indexOf(".");
      if (dot !== -1) nodes.add(track.name.slice(0, dot));
    }
    for (const nodeName of nodes) {
      const a = clipAnchor(clip, nodeName);
      if (a && (a.travel > 1e-4 || a.turn > 1e-3)) return true;
    }
    warnOnce(
      `motion:${clip.name}`,
      `clip "${clip.name}" binds but every track is constant — it would make the ` +
        `${label} appear and disappear rather than move; using the procedural fallback.`
    );
    return false;
  }

  /** Play an authored clip once on `root`'s subtree, retimed to `seconds`.
      `snap` sets the exact rest pose on 'finished' (and immediately under
      reducedMotion). Returns false when the clip cannot bind or has no motion
      to show — in both cases the caller must run its procedural arc instead. */
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
    if (!hasMotion(clip, seconds, label)) return false;
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

  /** Every sub-mesh in `root` that uses material `matName`. */
  function meshesOfMaterial(root: THREE.Object3D, matName: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => m.name === matName)) out.push(mesh);
    });
    return out;
  }

  /**
   * The outline(s) of a mesh's TOP face, in world XZ.
   *
   * Takes every triangle whose three corners sit on the highest y in the mesh
   * (for the felt slab that is exactly its top face — the sides and underside
   * carry different normals and therefore different vertices), keeps the edges
   * used by a single triangle, and chains them into rings. The result is the
   * felt's real half-moon silhouette plus one ring per hole cut in it (the
   * recessed chip-tray pocket). Returns [] if the mesh has no index buffer.
   */
  function topFaceRings(mesh: THREE.Mesh): Ring[] {
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();
    if (!pos || !index) return [];
    mesh.updateWorldMatrix(true, false);
    const world = new Float64Array(pos.count * 3);
    const v = new THREE.Vector3();
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world[i * 3] = v.x;
      world[i * 3 + 1] = v.y;
      world[i * 3 + 2] = v.z;
      if (v.y > maxY) maxY = v.y;
    }
    const EPS = 1e-4;
    const key = (i: number) => `${world[i * 3].toFixed(4)},${world[i * 3 + 2].toFixed(4)}`;
    const onTop = (i: number) => Math.abs(world[i * 3 + 1] - maxY) < EPS;
    const counts = new Map<string, { n: number; a: string; b: string }>();
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      if (!onTop(a) || !onTop(b) || !onTop(c)) continue;
      for (const [u, w] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const ku = key(u);
        const kw = key(w);
        if (ku === kw) continue;
        const k = ku < kw ? `${ku}|${kw}` : `${kw}|${ku}`;
        const seen = counts.get(k);
        if (seen) seen.n++;
        else counts.set(k, { n: 1, a: ku, b: kw });
      }
    }
    const adj = new Map<string, string[]>();
    for (const e of counts.values()) {
      if (e.n !== 1) continue; // interior edge — shared by two triangles
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      (adj.get(e.a) as string[]).push(e.b);
      (adj.get(e.b) as string[]).push(e.a);
    }
    const visited = new Set<string>();
    const rings: Ring[] = [];
    for (const start of adj.keys()) {
      if (visited.has(start)) continue;
      const ring: Ring = [];
      let prev: string | null = null;
      let cur: string | null = start;
      while (cur !== null && !visited.has(cur)) {
        visited.add(cur);
        const [x, z] = cur.split(",");
        ring.push(new THREE.Vector2(Number(x), Number(z)));
        const nbrs = adj.get(cur) as string[];
        const next = nbrs.find((n) => n !== prev && !visited.has(n)) ?? null;
        prev = cur;
        cur = next;
      }
      if (ring.length >= 3) rings.push(ring);
    }
    return rings;
  }

  /** |signed area| of a ring, used to pick the outline out of the holes. */
  function ringArea(ring: Ring): number {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    }
    return Math.abs(a) / 2;
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

  /**
   * Measure the rail's OVERHANG over the felt.
   *
   * The rail is a padded tube whose centreline runs just outside the felt's
   * edge, so part of it sits ON the felt — which is precisely why "inside the
   * felt bounding box" used to land chips on the rail. Every S7_Rail vertex
   * ABOVE the felt surface belongs to that tube (the table body slab tops out
   * at the felt line); the deepest one that falls inside the felt outline is
   * how far the playable surface has to be pulled in.
   */
  function measureRailInset(
    /** The TABLE node only: the trays share S7_Rail and stand well inside the
        felt, so measuring the whole glb would read a tray as a rail overhang. */
    table: THREE.Object3D,
    ring: Ring,
    holes: Ring[],
    feltTop: number,
    limit: number
  ): number {
    const rails = meshesOfMaterial(table, MAT_RAIL);
    if (rails.length === 0) {
      warnOnce("rail", `no "${MAT_RAIL}" material found — using the fallback rail inset.`);
      return 0.03 * TABLE_SCALE;
    }
    const v = new THREE.Vector3();
    let inset = 0;
    for (const mesh of rails) {
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!pos) continue;
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y <= feltTop + 1e-4) continue; // table body slab, not the tube
        if (!pointInRing(ring, v.x, v.z)) continue;
        let d = distToRing(ring, v.x, v.z);
        for (const hole of holes) {
          if (pointInRing(hole, v.x, v.z)) d = 0;
        }
        if (d > inset) inset = d;
      }
    }
    // A rail can only ever cover a sliver of the felt; anything more means the
    // mesh is not what we think it is, and a runaway inset would be worse than
    // no inset at all.
    return Math.min(inset, limit);
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
      feltRing: base.feltRing,
      feltHoles: [],
      obstacles: [],
      betCenter: new THREE.Vector2(
        GLB_BET_CENTER.x * TABLE_SCALE,
        GLB_BET_CENTER.y * TABLE_SCALE
      ),
      betRadius: GLB_BET_RADIUS * TABLE_SCALE,
      shoeMouth: base.shoeMouth.clone(),
      payoutFrom: base.payoutFrom.clone(),
      discardTo: base.discardTo.clone(),
    };

    // ── The playable surface: felt outline, its holes, the rail overhang ──
    const feltMeshes = table ? meshesOfMaterial(table, MAT_FELT) : [];
    const rings = feltMeshes.length ? topFaceRings(feltMeshes[0]) : [];
    if (rings.length === 0) {
      warnOnce(
        "feltring",
        `could not trace the "${MAT_FELT}" top face — falling back to an inset ` +
          `bounding box, which is more conservative than the real half-moon.`
      );
      m.feltRing = roundedRectRing(
        (m.maxX - m.minX) / 2,
        (m.maxZ - m.minZ) / 2,
        Math.min(m.maxX - m.minX, m.maxZ - m.minZ) * 0.3
      );
    } else {
      let outline = rings[0];
      let best = ringArea(outline);
      for (const r of rings) {
        const a = ringArea(r);
        if (a > best) {
          best = a;
          outline = r;
        }
      }
      m.feltRing = outline;
      m.feltHoles = rings.filter((r) => r !== outline);
    }
    m.railInset = measureRailInset(
      table ?? root,
      m.feltRing,
      m.feltHoles,
      m.top,
      Math.min(m.maxX - m.minX, m.maxZ - m.minZ) * 0.06
    );

    // The felt's tray POCKET reaches further toward the player than the tray
    // that sits in it, so it — not the tray — is the dealer row's back wall.
    m.pocketFrontZ = m.minZ;
    for (const hole of m.feltHoles) {
      for (const p of hole) {
        if (p.y > m.pocketFrontZ && p.y < m.betCenter.y) m.pocketFrontZ = p.y;
      }
    }

    // The dealer's raised chip tray is the dealer row's front wall.
    const tray = root.getObjectByName("ChipTray");
    if (tray) {
      const b = new THREE.Box3().setFromObject(tray);
      m.trayFrontZ = b.max.z;
      b.getCenter(m.payoutFrom);
      m.payoutFrom.y = m.top + m.chipHeight / 2;
      m.obstacles.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
    } else {
      m.trayFrontZ = m.minZ + (m.maxZ - m.minZ) * 0.28;
    }

    // Rows must also stay clear of the discard tray (left) and the shoe (right)
    // — both raised props standing on the felt.
    let halfSpan = Math.min(Math.abs(m.minX), m.maxX);
    const discard = root.getObjectByName("DiscardTray");
    if (discard) {
      const b = new THREE.Box3().setFromObject(discard);
      m.obstacles.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
      b.getCenter(m.discardTo);
      m.discardTo.y = b.max.y;
    }
    const shoeNode = root.getObjectByName(GLB_SHOE_NODE);
    if (shoeNode) {
      const b = new THREE.Box3().setFromObject(shoeNode);
      m.obstacles.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
      // The clip-less deal arc starts at the shoe's mouth.
      m.shoeMouth.set(b.min.x + (b.max.x - b.min.x) * 0.35, b.max.y * 0.8, b.max.z);
    }
    m.rowHalfSpan = Math.max(0.9, halfSpan);

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
    placeMartini();
    placeDeck();
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

    // Table5 is the wider 5-seat variant, shipped for future multiplayer. It
    // shares S7_Felt / S7_Rail with Table and is 1.33x as wide, so leaving it
    // in would both double-render the felt and — if anything measured it —
    // hand the solver a table that is not the one being played on. Hidden, not
    // deleted; every measurement below is scoped to the "Table" node.
    const table5 = root.getObjectByName(GLB_TABLE5_NODE);
    if (table5) table5.visible = false;

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

    adoptDealer(root);
    applyLayout(solveLayout(measureFromGlb(root)));
    buildDeck();
    playIntro(root);
  }

  /** TableIntro + the camera push-in. Skipped entirely under reduced motion. */
  function playIntro(root: THREE.Object3D) {
    if (reduced) return;
    if (rows.player.length || rows.dealer.length) return; // mid-hand load
    const intro = glbClips.TableIntro;
    const shoeNode = root.getObjectByName(GLB_SHOE_NODE);
    if (intro && shoeNode) {
      primeToClipStart(shoeNode, intro);
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

  /* ── The shoe's deck of face-down cards ───────────────────────────────── */

  /**
   * A real stack of card backs sitting in the shoe's mouth, so the player can
   * SEE where the cards come from — and see the shoe run down.
   *
   * Placement is measured, not guessed: the stack's bottom card is pinned to
   * CardDeal's own FIRST keyframe (position AND orientation), which is the
   * pose the author parked the next card in. That is inside the measured shoe
   * slot (S7_ShoeSlot spans world y 0.423–0.468 and the anchor is y 0.456), at
   * the shoe's authored yaw of −26°, and it means the card that flies out is
   * literally the card you were looking at. It also cannot drift: change
   * TABLE_SCALE or re-author the clip and the deck follows.
   *
   * Cost: ONE shared geometry for the cards (the same PlaneGeometry every
   * dealt card uses) plus one unit box for the block, and two materials. No
   * per-frame allocation — depletion only toggles `visible` and rescales the
   * block. Disposed on unmount.
   */
  interface DeckStack {
    group: THREE.Group;
    cards: THREE.Mesh[];
    /** The solid body under the top cards: the deck's paper edge. */
    body: THREE.Mesh;
    disposables: { dispose(): void }[];
    remaining: number;
  }
  let deck: DeckStack | null = null;

  function disposeDeck() {
    if (!deck) return;
    scene.remove(deck.group);
    for (const d of deck.disposables) d.dispose();
    deck = null;
  }

  function buildDeck() {
    disposeDeck();
    const deal = glbClips.CardDeal;
    if (!deal || !clipAnchor(deal, GLB_CARD_NODE)) {
      warnOnce(
        "deck",
        `no "CardDeal" curve to pin the shoe's deck to — the shoe is drawn empty.`
      );
      return;
    }
    const backMat = new THREE.MeshStandardMaterial({
      map: backTexture(),
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.66,
      metalness: 0.04,
      envMapIntensity: 0.5,
    });
    // The paper edge of the block. Warm off-white so the stack reads as a
    // stack against black felt, rather than as a hole.
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x9c9179,
      roughness: 0.92,
      metalness: 0,
    });
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);

    const group = new THREE.Group();
    group.name = "ShoeDeck";
    const body = new THREE.Mesh(bodyGeo, edgeMat);
    body.castShadow = true;
    group.add(body);
    const cards: THREE.Mesh[] = [];
    for (let i = 0; i < DECK_CARDS; i++) {
      // Shared cardGeo — the exact geometry a dealt card uses, so the stack and
      // the card that leaves it are the same object at the same size.
      const mesh = new THREE.Mesh(cardGeo, backMat);
      // Euler XYZ applies z first: an in-plane wobble, then laid flat.
      mesh.rotation.set(-Math.PI / 2, 0, rand(-1, 1) * ((1.7 * Math.PI) / 180));
      mesh.position.set(rand(-0.009, 0.009), i * DECK_STEP, rand(-0.009, 0.009));
      group.add(mesh);
      cards.push(mesh);
    }
    scene.add(group);
    deck = { group, cards, body, disposables: [backMat, edgeMat, bodyGeo], remaining: DECK_CARDS };
    placeDeck();
    showDeck(DECK_CARDS);
  }

  /** Re-seat the deck after a layout change (it carries the card scale). */
  function placeDeck() {
    if (!deck) return;
    const deal = glbClips.CardDeal;
    const a = deal ? clipAnchor(deal, GLB_CARD_NODE) : null;
    if (!a) return;
    deck.group.position.copy(a.first).multiplyScalar(TABLE_SCALE);
    deck.group.quaternion.copy(a.firstQuat);
    // Same scale as a dealt card, so the deck reads as these cards.
    deck.group.scale.setScalar(layout.cardScale);
  }

  /** Show `n` cards. The stack thins from the TOP; the bottom card — the one
      the next deal flies out of — never moves. */
  function showDeck(n: number) {
    if (!deck) return;
    const vis = THREE.MathUtils.clamp(Math.round(n), 0, deck.cards.length);
    deck.remaining = vis;
    for (let i = 0; i < deck.cards.length; i++) {
      const card = deck.cards[i];
      card.visible = i < vis;
      card.castShadow = i === vis - 1; // only the top card needs to cast
    }
    deck.group.visible = vis > 0;
    deck.body.visible = vis > 0;
    const thick = Math.max(DECK_STEP, (vis - 1) * DECK_STEP);
    // Inset so the card planes' edges stay proud of the block.
    deck.body.scale.set(CARD_W * 0.955, thick, CARD_H * 0.955);
    deck.body.position.set(0, ((vis - 1) * DECK_STEP) / 2, 0);
  }

  /** One card leaves the shoe. Floors at DECK_MIN_CARDS: an empty-looking shoe
      mid-shoe reads as a bug, and the real reshuffle is what refills it. */
  function deckTake() {
    if (!deck) return;
    showDeck(Math.max(DECK_MIN_CARDS, deck.remaining - 1));
  }

  /** The shoe is reloaded — grow the stack back over the ShoeRefill beat. */
  function deckRefill() {
    if (!deck) return;
    const from = deck.remaining;
    if (reduced) {
      showDeck(DECK_CARDS);
      return;
    }
    tween(0, REFILL_SECONDS, (e) => {
      showDeck(from + (DECK_CARDS - from) * e);
    });
  }

  /* ── The dealer ───────────────────────────────────────────────────────── */

  /**
   * Wire the authored dealer.
   *
   * He is a SkinnedMesh rig ("DealerRig" → 11 bones + a "Dealer" group of six
   * skinned sub-meshes), authored in TABLE space standing in the dealer notch,
   * so he rides the same TABLE_SCALE root as everything else and needs no
   * placement of his own. He is NEVER cloned: a plain Object3D.clone() would
   * copy the meshes but not rebind them to the cloned skeleton, and he would
   * collapse. One mixer drives him for the life of the scene — DealerIdle on
   * a loop, with the one-shots cross-fading over it.
   */
  function adoptDealer(root: THREE.Object3D) {
    const rig = root.getObjectByName(GLB_DEALER_RIG) ?? root.getObjectByName(GLB_DEALER_NODE);
    if (!rig) {
      warnOnce("dealer", `no "${GLB_DEALER_RIG}" in the glb — the table plays without a dealer.`);
      return;
    }
    dealerRig = rig;
    rig.visible = true;
    rig.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false; // a skinned bbox is the BIND pose, not the pose
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        // He stands beyond the felt pool: without a lift he reads as a black
        // cut-out. The env gives the jacket and shirt their shape back.
        if (std.isMeshStandardMaterial) std.envMapIntensity = /Gold/i.test(std.name) ? 1.3 : 0.85;
      }
    });

    // A small local fill just in front of his chest, MEASURED off his own
    // bounding box rather than guessed. Decay 2 with a short throw: it lands
    // ~1.5 at the jacket (comparable to the key light, so the lapels and the
    // shirt keep their shape) and is down to ~0.4 by the time it reaches the
    // felt two metres below — a lift on the dealer's side of the table, not a
    // second lamp pool competing with the house spot.
    const box = new THREE.Box3().setFromObject(rig);
    const chestY = box.min.y + (box.max.y - box.min.y) * 0.72;
    dealerFill.position.set(0, chestY, box.max.z + 0.6 * LS);
    dealerFill.distance = 3.0 * LS;
    dealerFill.intensity = 0.95 * LS * LS;

    const idle = glbClips[DEALER_IDLE];
    if (!idle) {
      warnOnce("dealerclip", `clip "${DEALER_IDLE}" is missing — the dealer stands still.`);
      return;
    }
    // Same guard as every other clip: a rig primed to the idle's first pose is
    // never parked in some other authored pose while it waits.
    primeToClipStart(rig, idle);
    if (reduced) return; // visible, but static
    if (!bindsCleanly(rig, idle, "dealer rig")) return;
    if (!hasMotion(idle, idle.duration, "dealer rig")) return;
    dealerMixer = new THREE.AnimationMixer(rig);
    dealerIdleAction = dealerMixer.clipAction(idle);
    dealerIdleAction.setLoop(THREE.LoopRepeat, Infinity);
    dealerIdleAction.clampWhenFinished = false;
    dealerIdleAction.setEffectiveWeight(1);
    dealerIdleAction.play();
    activeMixers.add(dealerMixer);
  }

  /**
   * Fire one of the dealer's one-shots over the idle loop.
   *
   * Blending is a rate-limited weight ramp stepped once per frame (see
   * stepDealer) rather than crossFadeFrom/fadeIn. Those schedule interpolants
   * inside the mixer that a SUPERSEDED one-shot never unwinds: dealing the
   * second card 0.4 s into the first card's reach used to strand the idle at a
   * fraction of its weight — measured at 6% of its normal travel, a dealer who
   * goes still after the first hand — and snapping the idle back to 1 to fix
   * that produced a 0.77-world-unit hand jump in a single frame. A weight that
   * can only move dt/DEALER_FADE per frame cannot jump, whatever arrives on
   * top of what.
   *
   * The clip is retimed by the same factor as the prop clip it accompanies, so
   * the reach stays locked to the card or chip it belongs to.
   */
  /**
   * An AnimationAction for `clip` that is not already weighted onto the rig.
   *
   * mixer.clipAction() returns the SAME action for the same clip, so two
   * overlapping reaches from one clip would fight over one clock. Cloned
   * clips give genuinely independent actions; at most three per clip name,
   * built lazily and only ever when an overlap actually happens.
   */
  function dealerFreeAction(
    mixer: THREE.AnimationMixer,
    clip: THREE.AnimationClip
  ): THREE.AnimationAction | null {
    let variants = dealerVariants.get(clip.name);
    if (!variants) {
      variants = [clip];
      dealerVariants.set(clip.name, variants);
    }
    for (const variant of variants) {
      const action = mixer.clipAction(variant);
      if (!dealerShots.some((s) => s.action === action)) return action;
    }
    if (variants.length >= 3) return null;
    const extra = clip.clone();
    extra.name = `${clip.name}#${variants.length}`;
    variants.push(extra);
    return mixer.clipAction(extra);
  }

  function playDealerClip(name: string, seconds: number, delay: number) {
    if (reduced || disposed) return;
    const mixer = dealerMixer;
    const idle = dealerIdleAction;
    const clip = glbClips[name];
    if (!mixer || !idle) return;
    if (!clip) {
      warnOnce(`dealerclip:${name}`, `clip "${name}" is missing — the dealer keeps idling.`);
      return;
    }
    if (!dealerRig || !bindsCleanly(dealerRig, clip, "dealer rig")) return;
    if (!hasMotion(clip, seconds, "dealer rig")) return;
    at(delay, () => {
      if (disposed || !dealerMixer || !dealerIdleAction) return;
      // A FREE action, so the second card's reach cross-fades with the first
      // card's instead of resetting the same action mid-swing (which snapped
      // the arm back to its start pose — a 0.53-unit hand jump in one frame).
      const action = dealerFreeAction(mixer, clip);
      if (!action) return; // every variant is already reaching; let it carry
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveTimeScale(clip.duration / Math.max(0.05, seconds));
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      const shot: DealerShot = { action, weight: 0, target: 1, seq: ++dealerSeq };
      dealerShots.push(shot);
      // Anything else on the rig starts giving way immediately.
      for (const other of dealerShots) if (other !== shot) other.target = 0;
      const mine = shot;
      const seq = mine.seq;
      // Hand the bones back to the idle loop just before the reach resolves,
      // so the ramp is finished by the time the clip clamps.
      at(Math.max(0, seconds - DEALER_FADE), () => {
        if (mine.seq === seq) mine.target = 0;
      });
    });
  }

  /**
   * Per-frame dealer blend. Every one-shot weight walks toward its target at
   * most dt/DEALER_FADE per frame and the idle takes whatever weight is left,
   * so no pose can ever cut in or out. A shot that reaches zero is stopped and
   * dropped; nothing is allocated here.
   */
  function stepDealer(dt: number) {
    const idle = dealerIdleAction;
    if (!idle) return;
    const rate = DEALER_FADE > 0 ? dt / DEALER_FADE : 1;
    let sum = 0;
    for (let i = dealerShots.length - 1; i >= 0; i--) {
      const shot = dealerShots[i];
      shot.weight += THREE.MathUtils.clamp(shot.target - shot.weight, -rate, rate);
      if (shot.target === 0 && shot.weight <= 1e-3) {
        shot.action.stop();
        dealerShots.splice(i, 1);
        continue;
      }
      shot.action.setEffectiveWeight(shot.weight);
      sum += shot.weight;
    }
    idle.enabled = true;
    idle.setEffectiveWeight(Math.max(0, 1 - Math.min(1, sum)));
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
      In glb-clip mode the offset is CardDeal's own final keyframe, scaled —
      never a copied constant. Writes into `out`: this runs per frame. */
  function groupPosFor(entry: CardEntry, home: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const deal = glbClips.CardDeal;
    if (entry.usingClip && deal) return anchorEnd(deal, GLB_CARD_NODE, home, out);
    return out.copy(home);
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
      primeToClipStart(inner, deal);
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
          restPose(deal, GLB_CARD_NODE, inner);
        },
        "card wrapper"
      );

      if (played) {
        at(delay, () => {
          audio.play("cardSlide");
          deckTake(); // the card that leaves is the one off the top of the stack
        });
        // The author timed DealerDeal's reach to peak where CardDeal's card
        // clears the shoe lip, so the two start together and are retimed by the
        // same factor — slowing the card slows the hand with it.
        playDealerClip(DEALER_DEAL, DEAL_SECONDS, delay);
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
    at(delay, () => {
      audio.play("cardSlide");
      deckTake();
    });
    playDealerClip(DEALER_DEAL, DEAL_SECONDS, delay);
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
    // Anchored on the clip's FIRST keyframe so the sweep leaves from exactly
    // where the card is lying, whatever the author's start pose happens to be.
    const base = anchorStart(clip, GLB_CARD_NODE, entry.home, new THREE.Vector3());
    wrapper.position.copy(base);
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

  /**
   * Clip-less sweep: the card still TRAVELS to the discard tray on a low arc.
   * A card must never simply blink out — that is the same "it just
   * disappeared" the authored clips exist to avoid.
   */
  function proceduralDiscard(entry: CardEntry, delay: number): boolean {
    if (reduced || disposed) return false;
    const node = entry.group;
    const from = node.position.clone();
    const to = layout.metrics.discardTo.clone();
    if (entry.usingClip) to.y -= 0; // the wrapper already carries the rest offset
    const spin = entry.jitter;
    discarding.add(entry);
    tween(
      delay,
      DISCARD_SECONDS,
      (e, k) => {
        node.position.x = from.x + (to.x - from.x) * e;
        node.position.z = from.z + (to.z - from.z) * e;
        node.position.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * 0.22 * TABLE_SCALE;
        node.rotation.y = spin + e * 0.7;
      },
      () => {
        discarding.delete(entry);
        scene.remove(node);
        for (const m of entry.mats) m.dispose();
      }
    );
    return true;
  }

  function clearRow(row: "player" | "dealer") {
    rows[row].forEach((entry, i) => {
      if (!disposed && !reduced) {
        if (discardCard(entry, i * 0.06)) return;
        if (proceduralDiscard(entry, i * 0.06)) return;
      }
      removeCard(entry);
    });
    rows[row].length = 0;
  }

  /** Hole-card reveal: the authored CardFlip, or a lift-and-roll fallback. */
  function flipHole(entry: CardEntry) {
    entry.faceDown = false;
    const { flip, group, card } = entry;
    audio.play("cardFlip");
    playDealerClip(DEALER_FLIP, FLIP_SECONDS, 0);
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
          restPose(clip, GLB_CARD_NODE, card);
        },
        "card wrapper"
      );
      if (played) return;
    }
    const restY = groupPosFor(entry, entry.home, _vA).y;
    tween(0, FLIP_SECONDS, (e, k) => {
      flip.rotation.z = Math.PI * (1 - e);
      group.position.y = restY + Math.sin(Math.PI * k) * 0.15 * TABLE_SCALE;
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
        primeToClipStart(chip, toss); // never hover mid-air
        const wrapper = new THREE.Group();
        wrapper.scale.setScalar(TABLE_SCALE);
        // Anchored on ChipToss' OWN final keyframe: wherever the author landed
        // the chip, this offset puts that landing on `rest`. The y half of the
        // offset (this chip's slot in the stack) eases in over the flight so a
        // tall stack's chips don't sail in high above the felt.
        const anchor = anchorEnd(toss, GLB_CHIP_NODE, rest, new THREE.Vector3());
        const yOffset = anchor.y;
        wrapper.position.set(anchor.x, 0, anchor.z);
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
        primeToClipStart(chip, clip);
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
      (e, k) => {
        chip.position.x = worldStart.x + (worldEnd.x - worldStart.x) * e;
        chip.position.z = worldStart.z + (worldEnd.z - worldStart.z) * e;
        // A real arc, not a slide: the fallback has to read as a throw.
        chip.position.y =
          worldStart.y + (worldEnd.y - worldStart.y) * e + Math.sin(Math.PI * k) * 0.2 * TABLE_SCALE;
        chip.rotation.y = (1 - e) * 1.8;
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
    // disposeRack() empties hitMeshes, so the martini re-registers here.
    hitMeshes.push(martini.hit);
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
    // The martini is a prop, not a bet — it stays live in every phase.
    const next =
      target && target.kind === "rack" && !target.stack.enabled
        ? null
        : target && target.kind === "bet" && !(phase === "BETTING" && lastBet > 0)
          ? null
          : target;
    if (next === hovered) return;
    if (hovered && hovered.kind === "rack") hovered.stack.hovered = false;
    if (hovered && hovered.kind === "martini") martini.hovered = false;
    hovered = next;
    if (hovered && hovered.kind === "rack") hovered.stack.hovered = true;
    if (hovered && hovered.kind === "martini") martini.hovered = true;
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


  /* The martini (3D prop on the felt, clickable) --------------------------- */

  /**
   * A lathed glass standing on the player's right: a conical bowl on a stem
   * and foot (one LatheGeometry surface, thin transmissive glass), a pale-gold
   * liquid cone inside it whose apex sits at the bowl's apex — so the level is
   * just a uniform scale on the cone, never a rebuilt geometry — and an olive
   * on a pick. Click it to take a sip (five of them); click the empty glass
   * for another round. The level lives in localStorage `suite7:martini`, the
   * same key the retired DOM martini used, so an in-progress drink carries over.
   */
  interface MartiniProp {
    group: THREE.Group;
    /** Scaled on hover; holds everything so the whole prop ticks together. */
    body: THREE.Group;
    /** Sits at the bowl's apex — scale = fill level, rotation = slosh. */
    liquidPivot: THREE.Group;
    hit: THREE.Mesh;
    glassMat: THREE.MeshPhysicalMaterial;
    sips: number;
    /** Displayed fill, 0→1, tweened toward sips / MARTINI_SIPS. */
    fill: number;
    /** Bumped per sip so an older, slower pour can't out-write a newer one. */
    pour: number;
    hovered: boolean;
    hover: number;
    slosh: number;
    sloshVel: number;
  }

  const martiniDisposables: { dispose(): void }[] = [];

  function readMartiniSips(): number {
    try {
      const raw = window.localStorage.getItem(MARTINI_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MARTINI_SIPS) return parsed;
      }
    } catch {
      // Private mode — pour a fresh one.
    }
    return MARTINI_SIPS;
  }

  function writeMartiniSips(sips: number) {
    try {
      window.localStorage.setItem(MARTINI_KEY, String(sips));
    } catch {
      // Non-fatal: the drink just doesn't survive a reload.
    }
  }

  function buildMartini(): MartiniProp {
    // Profile in authored table units, revolved about y. Rim r 0.20, total
    // height 0.444 — a real martini glass against a 6.0-wide table.
    const profile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.125, 0),
      new THREE.Vector2(0.125, 0.012),
      new THREE.Vector2(0.095, 0.02),
      new THREE.Vector2(0.03, 0.034),
      new THREE.Vector2(0.017, 0.06),
      new THREE.Vector2(0.016, 0.232),
      new THREE.Vector2(0.024, MARTINI_APEX_Y),
      new THREE.Vector2(MARTINI_RIM_R, MARTINI_RIM_Y),
      new THREE.Vector2(MARTINI_RIM_R, MARTINI_RIM_Y + 0.008),
    ];
    const glassGeo = new THREE.LatheGeometry(profile, 44);
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.06,
      transmission: 0.9,
      thickness: 0.34,
      ior: 1.45,
      transparent: true,
      side: THREE.DoubleSide,
      envMapIntensity: 1.1,
      emissive: new THREE.Color(GOLD_LIGHT),
      emissiveIntensity: 0,
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);

    // Liquid: a cone whose point is the bowl's apex, so `scale` IS the level.
    const liquidH = MARTINI_RIM_Y - MARTINI_APEX_Y;
    const liquidGeo = new THREE.CylinderGeometry(MARTINI_LIQUID_R, 0, liquidH, 40, 1, false);
    const liquidMat = new THREE.MeshStandardMaterial({
      color: 0xe6d49a,
      roughness: 0.14,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 0.9,
      // The cone is closed, so front faces are all that ever show.
      side: THREE.FrontSide,
    });
    const liquid = new THREE.Mesh(liquidGeo, liquidMat);
    liquid.position.y = liquidH / 2;
    const liquidPivot = new THREE.Group();
    liquidPivot.position.y = MARTINI_APEX_Y;
    liquidPivot.add(liquid);

    // Olive on a pick, leaning against the rim.
    const oliveGeo = new THREE.SphereGeometry(0.032, 18, 12);
    const oliveMat = new THREE.MeshStandardMaterial({ color: 0x59662a, roughness: 0.5 });
    const olive = new THREE.Mesh(oliveGeo, oliveMat);
    olive.position.set(-0.012, MARTINI_APEX_Y + 0.052, 0.02);
    const pickGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.30, 8);
    const pickMat = new THREE.MeshStandardMaterial({
      color: 0xd8b978,
      roughness: 0.3,
      metalness: 0.7,
    });
    const pick = new THREE.Mesh(pickGeo, pickMat);
    pick.position.set(0.05, MARTINI_APEX_Y + 0.14, 0.03);
    pick.rotation.z = -0.44;

    const body = new THREE.Group();
    body.add(glass, liquidPivot, olive, pick);
    // Nothing here casts: a transmissive material still writes an opaque
    // silhouette into the shadow map, and a solid black disc under a clear
    // glass looks far worse than no shadow at all.

    const group = new THREE.Group();
    group.add(body);

    // Generous invisible tap target around the whole glass.
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.visible = false; // still raycastable — Raycaster ignores `visible`
    hit.userData.target = { kind: "martini" } satisfies HitTarget;

    martiniDisposables.push(glassGeo, glassMat, liquidGeo, liquidMat, oliveGeo, oliveMat, pickGeo, pickMat);

    const sips = readMartiniSips();
    return {
      group,
      body,
      liquidPivot,
      hit,
      glassMat,
      sips,
      fill: sips / MARTINI_SIPS,
      pour: 0,
      hovered: false,
      hover: 0,
      slosh: 0,
      sloshVel: 0,
    };
  }

  const martini = buildMartini();
  scene.add(martini.group, martini.hit);
  placeMartini();

  /** Re-seat the glass after a layout change. */
  function placeMartini() {
    const spot = layout.martini;
    const m = layout.metrics;
    martini.group.position.set(spot.x, m.top, spot.z);
    martini.group.scale.setScalar(spot.scale);
    const r = MARTINI_RIM_R * spot.scale * 1.25;
    const h = (MARTINI_RIM_Y + 0.05) * spot.scale;
    martini.hit.scale.set(r, h / 0.6, r); // hitGeo is a unit-radius, 0.6-tall cylinder
    martini.hit.position.set(spot.x, m.top + h / 2, spot.z);
  }

  /** Take a sip — or, on an empty glass, pour another round. */
  function sipMartini() {
    const refill = martini.sips <= 0;
    martini.sips = refill ? MARTINI_SIPS : martini.sips - 1;
    writeMartiniSips(martini.sips);
    const from = martini.fill;
    const to = martini.sips / MARTINI_SIPS;
    if (reduced) {
      martini.fill = to;
      martini.slosh = 0;
      martini.sloshVel = 0;
      return;
    }
    const pour = ++martini.pour;
    tween(0, refill ? POUR_SECONDS : SIP_SECONDS, (e) => {
      // stepTweens runs newest-first, so a stale tween would otherwise win.
      if (martini.pour !== pour) return;
      martini.fill = from + (to - from) * e;
    });
    martini.sloshVel += refill ? -2.6 : 3.4;
  }

  /** Per-frame: hover tick, level, and the damped slosh. */
  function stepMartini(dt: number) {
    const want = martini.hovered ? 1 : 0;
    const ease = reduced ? 1 : Math.min(1, dt * 11);
    martini.hover += (want - martini.hover) * ease;
    if (Math.abs(martini.hover - want) < 0.002) martini.hover = want;
    martini.body.scale.setScalar(1 + martini.hover * 0.03);
    martini.glassMat.emissiveIntensity = martini.hover * 0.3;

    if (reduced) {
      martini.slosh = 0;
      martini.sloshVel = 0;
    } else {
      // Damped spring back to level.
      martini.sloshVel += (-46 * martini.slosh - 5.2 * martini.sloshVel) * dt;
      martini.slosh += martini.sloshVel * dt;
      if (Math.abs(martini.slosh) < 1e-4 && Math.abs(martini.sloshVel) < 1e-3) {
        martini.slosh = 0;
        martini.sloshVel = 0;
      }
    }
    const fill = Math.max(0.0001, martini.fill);
    martini.liquidPivot.scale.setScalar(fill);
    martini.liquidPivot.visible = martini.fill > 0.004;
    martini.liquidPivot.rotation.x = martini.slosh * 0.16;
    martini.liquidPivot.rotation.z = martini.slosh * 0.09;
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
    setHover(pick(ev.clientX, ev.clientY));
  };
  const onPointerLeave = () => setHover(null);
  const onClick = (ev: MouseEvent) => {
    const target = pick(ev.clientX, ev.clientY);
    if (!target) return;
    if (target.kind === "martini") {
      sipMartini();
      return;
    }
    if (phase !== "BETTING") return;
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
      // The house takes it — authored ChipSweep, circle → dealer tray, with the
      // dealer's own arm on the same beat.
      playDealerClip(DEALER_SWEEP, SWEEP_SECONDS, 0.15);
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
      const peak = (won ? 9 : 3.5) * LS * LS; // PointLight decay 2
      pulse.position.set(0, 1.15 * LS, won ? layout.playerZ : layout.dealerZ);
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
    deckRefill(); // the stack grows back as the shoe is reloaded
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
    primeToClipStart(group, sub);
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
    if (phase !== "BETTING" && hovered !== null && hovered.kind !== "martini") setHover(null);

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
    stepMartini(dt);
    stepDealer(dt);

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
    // A narrower viewport loses horizontal field in exact proportion to its
    // aspect, so it is bought straight back: REF/aspect restores the width the
    // framing was solved for. Capped, because past ~2.1x the table is so far
    // away the cards stop being readable — on a phone the outer rails are
    // deliberately allowed to crop instead (every playable thing still fits).
    const f = THREE.MathUtils.clamp(CAM_REF_ASPECT / aspect, 1, CAM_PULL_CAP);
    camBase.copy(CAM_BASE).multiplyScalar(f);
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
    scene.remove(martini.group, martini.hit);
    for (const d of martiniDisposables) d.dispose();
    martiniDisposables.length = 0;
    disposeDeck();
    if (dealerMixer) {
      dealerMixer.stopAllAction();
      if (dealerRig) dealerMixer.uncacheRoot(dealerRig);
      activeMixers.delete(dealerMixer);
    }
    dealerMixer = null;
    dealerIdleAction = null;
    dealerShots.length = 0;
    dealerVariants.clear();
    dealerRig = null;
    anchorCache.clear();
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
