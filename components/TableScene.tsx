"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Card, Outcome, Suit } from "@/lib/blackjack";

/**
 * TableScene — the 3D blackjack table (three.js, "video game graphics").
 *
 * Stateless-reactive: TableGame's state machine stays the single source of
 * truth. This component diffs each incoming props snapshot against its own
 * display list and turns the differences into animations — new card → deal
 * tween from the shoe, holeCardHidden flipping false → physical hole-card
 * flip, bet increase → chip toss, SETTLED → payout slide + win glow. It never
 * drives game state.
 *
 * ── Blender integration ─────────────────────────────────────────────────────
 * /public/brand/table-assets.glb (Blender-authored) is loaded asynchronously
 * after the procedural scene is up. When it arrives it supplies:
 *   • the ENVIRONMENT — Table/Shoe/ChipTray/DiscardTray replace the procedural
 *     felt + shoe (which stay built and merely turn invisible: they are the
 *     permanent fallback if the load fails);
 *   • the CHIPS — Chip7 clones (materials cloned + tinted per denomination);
 *   • the ANIMATION CURVES — the authored CardDeal / CardFlip / CardDiscard /
 *     ChipToss clips, retargeted onto the procedural cards and cloned chips by
 *     parenting each animated node under a per-instance wrapper Group and
 *     running a scoped AnimationMixer on that wrapper (the clips target node
 *     names "Card7S"/"Chip7", so the animated node is given that name).
 * The PLAYING CARDS stay procedural (canvas textures show correct ranks/suits;
 * the glb card's 7♠ face is geometry — no 52-face atlas until sprint 2).
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
  /** Settlement outcome for the win glow; null until SETTLED. */
  outcome: Outcome | null;
  /** Snap all animations to their final state; static camera. */
  reducedMotion: boolean;
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

/* ── World dimensions (arbitrary units, camera framed to fit) ────────────── */

const TABLE_W = 7.6;
const TABLE_D = 4.8;
const CARD_W = 0.72;
const CARD_H = 1.04;
const CARD_GAP = 0.44; // fan overlap step
const CHIP_R = 0.17;
const CHIP_H = 0.05;

/* ── The Blender glb contract (public/brand/table-assets.glb) ────────────── */

const GLB_URL = "/brand/table-assets.glb";
/** Authored table is 6.0 wide — scale it up to the old procedural footprint. */
const TABLE_SCALE = TABLE_W / 6.0;
/** Node / clip names inside the glb (verified author contract). */
const GLB_CARD_NODE = "Card7S";
const GLB_CHIP_NODE = "Chip7";
const GLB_ENV_NODES = ["Table", "Shoe", "ChipTray", "DiscardTray"] as const;
/** CardDeal's first key — the card resting inside the shoe (glTF Y-up). */
const DEAL_START_POS = new THREE.Vector3(1.819, 0.24, -0.892);
const DEAL_START_QUAT = new THREE.Quaternion(-0.1356, -0.2228, -0.0313, 0.9649);
/** A laid glb card rests at (0, 0.02, 0); ChipToss ends at (0, 0.0305, 0.90). */
const GLB_CARD_REST_Y = 0.02;
const GLB_CHIP_REST = new THREE.Vector3(0, 0.0305, 0.9);
const GLB_CHIP_H = 0.045; // authored chip height → bet-stack step
const GLB_FELT_Y = 0.008; // authored felt surface height
/* Authored clips are luxurious (CardDeal 1.33s) — retimed via timeScale. */
const DEAL_TIMESCALE = 2.0; // 1.33s → ~0.67s
const FLIP_TIMESCALE = 1.0; // 0.67s (matches the old 0.6s flip)
const DISCARD_TIMESCALE = 1.3; // 0.87s → ~0.67s
const TOSS_TIMESCALE = 1.6; // 0.80s → 0.5s

/* Rows sit clear of the glb ChipTray (dealer side) and betting circle. */
const DEALER_Z = -1.55;
const PLAYER_Z = 0.42;
const ROW_X0 = -0.95;
/** Betting circle center — authored at glb table space (0, −0.90), which is
    scene z = +0.90·TABLE_SCALE (player side is +z here). Was (0, 0.3). */
const BET_POS = { x: 0, z: 0.9 * TABLE_SCALE };
const BET_R = 0.34 * TABLE_SCALE; // authored circle radius, scaled
const SHOE_POS = new THREE.Vector3(3.0, 0.5, -1.3);
const CHIP_TOSS_FROM = new THREE.Vector3(0.9, 0.3, 2.7);
const DEALER_TRAY = new THREE.Vector3(-2.4, CHIP_H / 2, -1.7);

const MAX_BET_CHIPS = 12; // visual cap — larger bets are implied
const MAX_PAYOUT_CHIPS = 8;

const CAM_BASE = new THREE.Vector3(0, 4.4, 4.9);
const CAM_TARGET = new THREE.Vector3(0, 0, -0.15);

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

/* ── Procedural CanvasTextures (cached in the controller's Map) ──────────── */

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

/** The felt: rounded table top, gold trim ring, lighting pool, betting circle. */
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

  // Betting circle — thin gold line where the bet chips land.
  const px = (BET_POS.x / TABLE_W + 0.5) * w;
  const py = (BET_POS.z / TABLE_D + 0.5) * h;
  const pr = (BET_R / TABLE_W) * w;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(227, 192, 113, 0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, pr - 5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(227, 192, 113, 0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Soft radial contact-shadow blob (the cheap "no real shadows" trick). */
function paintShadow(ctx: CanvasRenderingContext2D, s: number) {
  const g = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  g.addColorStop(0.6, "rgba(0, 0, 0, 0.28)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
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

/* ── Controller ──────────────────────────────────────────────────────────── */

interface SyncProps {
  playerHand: Card[];
  dealerHand: Card[];
  holeCardHidden: boolean;
  phase: TablePhase;
  betChips: number;
  outcome: Outcome | null;
  reducedMotion: boolean;
}

interface Controller {
  sync(p: SyncProps): void;
  dispose(): void;
}

interface CardEntry {
  group: THREE.Group; // outermost scene node (glb mode: the retarget wrapper)
  flip: THREE.Group; // rotation.z = PI while face-down
  mats: THREE.MeshStandardMaterial[]; // per-card so the win pulse stays local
  shadow: THREE.Mesh;
  faceDown: boolean;
  home: THREE.Vector3;
  jitter: number;
  /** glb mode only: the node named "Card7S" the authored clips animate. */
  animRoot?: THREE.Group;
}

const SUIT_KEYS: Record<Suit, string> = { "♠": "S", "♥": "H", "♦": "D", "♣": "C" };

/** Throws if WebGL is unavailable — the caller falls back to DOM cards. */
function createController(mount: HTMLDivElement): Controller {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  const camBase = CAM_BASE.clone();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);

  /* Texture cache — one entry per card face, one back, felt, shadow, chips.
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
  const getFaceTexture = (card: Card) =>
    getTexture(`face:${card.rank}${SUIT_KEYS[card.suit]}`, 256, 372, (ctx, w, h) =>
      paintCardFace(ctx, w, h, card)
    );
  const getBackTexture = () => getTexture("back", 256, 372, (ctx, w, h) => paintCardBack(ctx, w, h));
  const getShadowTexture = () => getTexture("shadow", 128, 128, (ctx) => paintShadow(ctx, 128));

  /* Shared geometries (a handful total, whatever the hand count). */
  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  const feltGeo = new THREE.PlaneGeometry(TABLE_W, TABLE_D);
  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 24);
  const shoeGeo = new THREE.BoxGeometry(0.56, 0.4, 0.78);

  const sharedDisposables: { dispose(): void }[] = [cardGeo, shadowGeo, feltGeo, chipGeo, shoeGeo];

  /* The felt. */
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
  scene.add(felt);

  /* The shoe — a quiet dark block at the table's right edge. */
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.6, metalness: 0.3 });
  const shoeEdgeMat = new THREE.LineBasicMaterial({ color: 0xe3c071, transparent: true, opacity: 0.35 });
  const shoeEdges = new THREE.EdgesGeometry(shoeGeo);
  sharedDisposables.push(shoeMat, shoeEdgeMat, shoeEdges);
  const shoe = new THREE.Mesh(shoeGeo, shoeMat);
  shoe.position.set(SHOE_POS.x, 0.2, SHOE_POS.z);
  shoe.rotation.y = -0.35;
  shoe.add(new THREE.LineSegments(shoeEdges, shoeEdgeMat));
  scene.add(shoe);

  /* Shared contact-shadow material (opacity constant; scale animates). */
  const shadowMat = new THREE.MeshBasicMaterial({
    map: getShadowTexture(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  sharedDisposables.push(shadowMat);

  /* Chip materials — cached per denomination, shared across chip meshes. */
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

  /* Lighting: warm key, gold rim, low ambient, plus the win-pulse point. */
  const ambient = new THREE.AmbientLight(0x6b5a3a, 0.9);
  const key = new THREE.DirectionalLight(0xffe9c4, 1.7);
  key.position.set(1.4, 6, 3.6);
  const rim = new THREE.DirectionalLight(0xe3c071, 0.6);
  rim.position.set(-2.5, 3, -4.5);
  const pulse = new THREE.PointLight(0xf7e8ac, 0, 5, 2);
  pulse.position.set(0, 1.15, PLAYER_Z);
  scene.add(ambient, key, rim, pulse);

  /* ── Factories (the Blender-swap seam — see the top-of-file comment) ──── */

  function buildCardMesh(card: Card | "back"): {
    group: THREE.Group;
    flip: THREE.Group;
    mats: THREE.MeshStandardMaterial[];
  } {
    const backTex = getBackTexture();
    const faceTex = card === "back" ? backTex : getFaceTexture(card);
    const mkMat = (map: THREE.Texture) =>
      new THREE.MeshStandardMaterial({
        map,
        transparent: true,
        alphaTest: 0.35,
        roughness: 0.75,
        metalness: 0.05,
        emissive: new THREE.Color(GOLD_LIGHT),
        emissiveIntensity: 0,
      });
    const faceMat = mkMat(faceTex);
    const backMat = mkMat(backTex);
    const face = new THREE.Mesh(cardGeo, faceMat);
    face.rotation.x = -Math.PI / 2; // lie flat, face up, top toward the dealer
    face.position.y = 0.008;
    const back = new THREE.Mesh(cardGeo, backMat);
    back.rotation.x = Math.PI / 2; // underside
    back.position.y = -0.008;
    const flip = new THREE.Group();
    flip.add(face, back);
    const group = new THREE.Group();
    group.add(flip);
    return { group, flip, mats: [faceMat, backMat] };
  }

  function buildChipMesh(denom: number): THREE.Object3D {
    if (glbChipTemplate) {
      const chip = cloneGlbChip(denom);
      chip.position.set(0, 0, 0);
      chip.quaternion.identity();
      chip.scale.setScalar(TABLE_SCALE);
      return chip;
    }
    return new THREE.Mesh(chipGeo, getChipMats(denom));
  }

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
  let glbClips: {
    deal: THREE.AnimationClip;
    flip: THREE.AnimationClip;
    discard: THREE.AnimationClip;
    toss: THREE.AnimationClip;
  } | null = null;
  let glbChipTemplate: THREE.Object3D | null = null;
  const glbDisposables: { dispose(): void }[] = [];
  /* Tinted material clones, cached per denomination (keyed by source uuid). */
  const glbChipMats = new Map<number, Map<string, THREE.Material>>();

  /* Chip landing metrics + payout origin (procedural defaults; the glb swap
     raises them to the authored chip/tray dimensions). */
  let chipY0 = CHIP_H / 2;
  let chipStep = CHIP_H * 1.04;
  let shadowLift = 0; // contact shadows must clear the glb felt surface
  const payoutFrom = DEALER_TRAY.clone();

  /* One scoped AnimationMixer per animated instance, driven by the rAF dt. */
  const activeMixers = new Set<THREE.AnimationMixer>();

  /** Play an authored clip once on `root`'s subtree; `snap` sets the exact
      rest pose on 'finished' (and immediately under reducedMotion). */
  function playClip(
    root: THREE.Object3D,
    clip: THREE.AnimationClip,
    timeScale: number,
    delay: number,
    snap: () => void
  ) {
    if (reduced) {
      snap();
      return;
    }
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;
    if (delay > 0) action.startAt(delay);
    action.play();
    mixer.addEventListener("finished", () => {
      activeMixers.delete(mixer);
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      snap();
    });
    activeMixers.add(mixer);
  }

  /** Clone the glb Chip7, re-tinting cloned materials toward the denom color. */
  function cloneGlbChip(denom: number): THREE.Object3D {
    const chip = (glbChipTemplate as THREE.Object3D).clone(true);
    chip.visible = true;
    let tints = glbChipMats.get(denom);
    if (!tints) {
      tints = new Map();
      glbChipMats.set(denom, tints);
    }
    const cache = tints;
    const style = CHIP_STYLE[denom] ?? CHIP_STYLE[25];
    const tint = new THREE.Color(style.mid);
    chip.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const remap = (mat: THREE.Material): THREE.Material => {
        let clone = cache.get(mat.uuid);
        if (!clone) {
          clone = mat.clone();
          const std = clone as THREE.MeshStandardMaterial;
          if (std.color) std.color.lerp(tint, 0.55);
          cache.set(mat.uuid, clone);
          glbDisposables.push(clone);
        }
        return clone;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(remap) : remap(mesh.material);
    });
    return chip;
  }

  /** Swap the environment + chips + clips in once the glb has loaded. */
  function adoptGlb(gltf: GLTF) {
    const root = gltf.scene;
    for (const name of GLB_ENV_NODES) {
      if (!root.getObjectByName(name)) throw new Error(`glb missing ${name}`);
    }
    root.scale.setScalar(TABLE_SCALE);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      glbDisposables.push(mesh.geometry);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        glbDisposables.push(mat);
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map) glbDisposables.push(map);
      }
    });
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
    // glTF PBR reads darker than the procedural mats under the same rig.
    ambient.intensity = 1.25;
    key.intensity = 2.0;

    chipY0 = GLB_CHIP_REST.y * TABLE_SCALE;
    chipStep = GLB_CHIP_H * TABLE_SCALE;
    shadowLift = GLB_FELT_Y * TABLE_SCALE + 0.002;
    const tray = root.getObjectByName("ChipTray");
    if (tray) {
      tray.getWorldPosition(payoutFrom);
      payoutFrom.y = chipY0;
    }

    const deal = THREE.AnimationClip.findByName(gltf.animations, "CardDeal");
    const flipClip = THREE.AnimationClip.findByName(gltf.animations, "CardFlip");
    const discard = THREE.AnimationClip.findByName(gltf.animations, "CardDiscard");
    const toss = THREE.AnimationClip.findByName(gltf.animations, "ChipToss");
    if (deal && flipClip && discard && toss) {
      glbClips = { deal, flip: flipClip, discard, toss };
    }
    glbChipTemplate = chipTemplate;
    glbEnv = root;
  }

  /* ── Display lists ────────────────────────────────────────────────────── */

  const rows: { player: CardEntry[]; dealer: CardEntry[] } = { player: [], dealer: [] };
  const betStack: THREE.Object3D[] = []; // chips currently on the betting circle
  const transientChips: THREE.Object3D[] = []; // payout / swept chips mid-flight
  const discarding = new Set<CardEntry>(); // cards mid-CardDiscard (glb bonus)
  let betShadow: THREE.Mesh | null = null;
  let lastBet = 0;
  let settledHandled = false;

  function makeShadow(x: number, z: number, sx: number, sz: number, y: number): THREE.Mesh {
    const m = new THREE.Mesh(shadowGeo, shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, shadowLift + y, z); // lifted above the glb felt surface
    m.scale.set(sx, sz, 1);
    scene.add(m);
    return m;
  }

  function slotFor(row: "player" | "dealer", i: number): THREE.Vector3 {
    return new THREE.Vector3(
      ROW_X0 + i * CARD_GAP,
      0.02 + i * 0.008, // stack overlapping cards ever so slightly
      row === "player" ? PLAYER_Z : DEALER_Z
    );
  }

  function addCard(row: "player" | "dealer", card: Card, faceDown: boolean, delay: number) {
    const i = rows[row].length;
    const home = slotFor(row, i);
    const jitter = rand(-1, 1) * ((2 * Math.PI) / 180); // ±2° fan wobble
    const { group, flip, mats } = buildCardMesh(card);
    if (faceDown) flip.rotation.z = Math.PI;

    const shadow = makeShadow(home.x, home.z, CARD_W * 1.5, CARD_H * 1.3, 0.004 + i * 0.0005);
    shadow.scale.set(0, 0, 1);

    if (glbClips && !reduced) {
      // Authored CardDeal, retargeted: the clip animates a node named
      // "Card7S" from inside the Shoe to the glb-space origin, so the
      // procedural card group takes that name and goes under a wrapper whose
      // position lerps origin → slot. At k=0 the card sits exactly in the glb
      // Shoe (env and wrapper share scale + origin); at k=1 the clip's
      // authored rest lands exactly on the slot — both rows, no mirroring.
      group.name = GLB_CARD_NODE;
      group.position.copy(DEAL_START_POS);
      group.quaternion.copy(DEAL_START_QUAT);
      flip.scale.setScalar(1 / TABLE_SCALE); // wrapper scale ≠ card scale
      const wrapper = new THREE.Group();
      wrapper.scale.setScalar(TABLE_SCALE);
      wrapper.rotation.y = jitter;
      wrapper.add(group);
      scene.add(wrapper);

      const base = new THREE.Vector3(home.x, home.y - GLB_CARD_REST_Y * TABLE_SCALE, home.z);
      const entry: CardEntry = { group: wrapper, animRoot: group, flip, mats, shadow, faceDown, home, jitter };
      rows[row].push(entry);

      const dur = glbClips.deal.duration / DEAL_TIMESCALE;
      tween(delay, dur, (e) => {
        wrapper.position.copy(base).multiplyScalar(e);
        const s = 0.4 + 0.6 * e;
        shadow.scale.set(CARD_W * 1.5 * s * e, CARD_H * 1.3 * s * e, 1);
      });
      playClip(wrapper, glbClips.deal, DEAL_TIMESCALE, delay, () => {
        wrapper.position.copy(base);
        group.position.set(0, GLB_CARD_REST_Y, 0);
        group.quaternion.identity();
      });
      return;
    }

    // Procedural deal (also the reduced-motion snap path): fly in from the
    // shoe along a parabolic arc, spin settling. ~450ms.
    group.position.copy(SHOE_POS);
    group.rotation.y = jitter + 1.4;
    scene.add(group);
    const entry: CardEntry = { group, flip, mats, shadow, faceDown, home, jitter };
    rows[row].push(entry);
    tween(delay, 0.45, (e) => {
      group.position.x = SHOE_POS.x + (home.x - SHOE_POS.x) * e;
      group.position.z = SHOE_POS.z + (home.z - SHOE_POS.z) * e;
      group.position.y = SHOE_POS.y + (home.y - SHOE_POS.y) * e + Math.sin(Math.PI * e) * 0.5;
      group.rotation.y = jitter + (1 - e) * 1.4;
      const s = 0.4 + 0.6 * e;
      shadow.scale.set(CARD_W * 1.5 * s * e, CARD_H * 1.3 * s * e, 1);
    });
  }

  function removeCard(entry: CardEntry) {
    scene.remove(entry.group);
    scene.remove(entry.shadow);
    for (const m of entry.mats) m.dispose(); // textures stay cached
  }

  /** Bonus: authored CardDiscard — a swept card slides into the DiscardTray.
      Wrapper position lerps back to the origin, so the clip's authored end
      (the glb DiscardTray position) is hit exactly. */
  function discardCard(entry: CardEntry, delay: number) {
    const clips = glbClips as NonNullable<typeof glbClips>;
    const wrapper = entry.group;
    scene.remove(entry.shadow);
    discarding.add(entry);
    const base = wrapper.position.clone();
    const dur = clips.discard.duration / DISCARD_TIMESCALE;
    tween(delay, dur, (e) => {
      wrapper.position.copy(base).multiplyScalar(1 - e);
    });
    playClip(wrapper, clips.discard, DISCARD_TIMESCALE, delay, () => {
      discarding.delete(entry);
      scene.remove(wrapper);
      for (const m of entry.mats) m.dispose();
    });
  }

  function clearRow(row: "player" | "dealer") {
    rows[row].forEach((entry, i) => {
      if (!disposed && !reduced && glbClips && entry.animRoot) discardCard(entry, i * 0.06);
      else removeCard(entry);
    });
    rows[row].length = 0;
  }

  /** Hole-card reveal: lift ~0.15, roll PI around the long axis, set down. */
  function flipHole(entry: CardEntry) {
    entry.faceDown = false;
    const { flip, group, home, animRoot } = entry;
    if (glbClips && animRoot) {
      // Authored CardFlip ends clamped at rotation π about the long axis;
      // combined with the face-down flip group's π the card reads face-up
      // (2π). The snap collapses both back to 0 — visually identical.
      playClip(group, glbClips.flip, FLIP_TIMESCALE, 0, () => {
        flip.rotation.z = 0;
        animRoot.position.set(0, GLB_CARD_REST_Y, 0);
        animRoot.quaternion.identity();
      });
      return;
    }
    tween(0, 0.6, (e, k) => {
      flip.rotation.z = Math.PI * (1 - e);
      group.position.y = home.y + Math.sin(Math.PI * k) * 0.15;
    });
  }

  /* Chips ---------------------------------------------------------------- */

  function chipRest(i: number): THREE.Vector3 {
    return new THREE.Vector3(
      BET_POS.x + rand(-0.014, 0.014),
      chipY0 + i * chipStep,
      BET_POS.z + rand(-0.014, 0.014)
    );
  }

  function tossChips(delta: number) {
    if (!betShadow) betShadow = makeShadow(BET_POS.x, BET_POS.z, 0.62, 0.62, 0.003);
    const denoms = denomsFor(delta);
    denoms.forEach((denom, n) => {
      if (betStack.length >= MAX_BET_CHIPS) return; // extra chips are implied
      const i = betStack.length;
      if (glbClips && glbChipTemplate && !reduced) {
        // Authored ChipToss, retargeted: the clip ends on the betting circle
        // at glb-space (0, 0.0305, 0.90) — a parent offset makes that end
        // land on this chip's stack slot. The clone's rest pose IS the clip's
        // first key, so it sits at the toss origin until its action starts.
        const chip = cloneGlbChip(denom);
        const rest = chipRest(i);
        const wrapper = new THREE.Group();
        wrapper.scale.setScalar(TABLE_SCALE);
        wrapper.position.set(
          rest.x - GLB_CHIP_REST.x * TABLE_SCALE,
          0, // stack offset tweens in below (keeps the pre-toss chip on felt)
          rest.z - GLB_CHIP_REST.z * TABLE_SCALE
        );
        wrapper.add(chip);
        scene.add(wrapper);
        betStack.push(wrapper);
        const dur = glbClips.toss.duration / TOSS_TIMESCALE;
        tween(n * 0.09, dur, (e) => {
          wrapper.position.y = (rest.y - chipY0) * e;
        });
        playClip(wrapper, glbClips.toss, TOSS_TIMESCALE, n * 0.09, () => {
          // Snap: swap wrapper → bare chip at its exact rest pose so the
          // settle/payout slides (site tweens) keep driving a flat node.
          scene.remove(wrapper);
          const idx = betStack.indexOf(wrapper);
          if (idx === -1) return; // stack was swept mid-flight
          chip.position.copy(rest);
          chip.quaternion.identity();
          chip.scale.setScalar(TABLE_SCALE);
          scene.add(chip);
          betStack[idx] = chip;
        });
        return;
      }
      // Procedural toss (also the reduced-motion snap path).
      const chip = buildChipMesh(denom);
      const to = chipRest(i);
      const spin = rand(0, Math.PI * 2);
      chip.position.copy(CHIP_TOSS_FROM);
      chip.rotation.y = spin;
      scene.add(chip);
      betStack.push(chip);
      tween(n * 0.09, 0.42, (e, k) => {
        chip.position.x = CHIP_TOSS_FROM.x + (to.x - CHIP_TOSS_FROM.x) * e;
        chip.position.z = CHIP_TOSS_FROM.z + (to.z - CHIP_TOSS_FROM.z) * e;
        chip.position.y = CHIP_TOSS_FROM.y + (to.y - CHIP_TOSS_FROM.y) * e + Math.sin(Math.PI * k) * 0.35;
        chip.rotation.y = spin + (1 - e) * 2.2;
        chip.rotation.x = (1 - e) * 0.5;
      });
    });
  }

  function clearBetStack() {
    for (const chip of betStack) scene.remove(chip);
    betStack.length = 0;
    if (betShadow) {
      scene.remove(betShadow);
      betShadow = null;
    }
  }

  /** Slide a chip toward `to`, sinking under the felt near the end, then remove. */
  function slideChipAway(chip: THREE.Object3D, to: THREE.Vector3, delay: number) {
    const from = chip.position.clone();
    transientChips.push(chip);
    tween(
      delay,
      0.65,
      (e) => {
        chip.position.x = from.x + (to.x - from.x) * e;
        chip.position.z = from.z + (to.z - from.z) * e;
        const sink = Math.max(0, (e - 0.55) / 0.45);
        chip.position.y = from.y * (1 - sink) - 0.14 * sink;
      },
      () => {
        scene.remove(chip);
        const idx = transientChips.indexOf(chip);
        if (idx !== -1) transientChips.splice(idx, 1);
      }
    );
  }

  function clearTransients() {
    for (const chip of transientChips) scene.remove(chip);
    transientChips.length = 0;
  }

  /* Settlement ------------------------------------------------------------ */

  function runSettle(outcome: Outcome) {
    const stack = betStack.splice(0);
    if (betShadow) {
      scene.remove(betShadow);
      betShadow = null;
    }
    const won = outcome === "win" || outcome === "blackjack";
    const dest = outcome === "lose" ? new THREE.Vector3(-0.2, 0, -2.55) : new THREE.Vector3(0.25, 0, 2.65);
    stack.forEach((chip, i) => slideChipAway(chip, dest, 0.25 + i * 0.05));

    if (won) {
      // Payout chips pour from the dealer tray toward the player, then bank.
      const denoms = denomsFor(outcome === "blackjack" ? lastBet * 1.5 : lastBet).slice(
        0,
        MAX_PAYOUT_CHIPS
      );
      denoms.forEach((denom, i) => {
        const chip = buildChipMesh(denom);
        chip.position.set(payoutFrom.x + rand(-0.05, 0.05), payoutFrom.y, payoutFrom.z + rand(-0.05, 0.05));
        chip.rotation.y = rand(0, Math.PI * 2);
        scene.add(chip);
        slideChipAway(
          chip,
          new THREE.Vector3(0.45 + (i % 3) * 0.38, 0, 2.45 + Math.floor(i / 3) * 0.1),
          0.15 + i * 0.07
        );
      });
    }

    // Win glow: gold point-light pulse + a brief emissive tick on the
    // winning side's cards. The SETTLED banner itself stays DOM.
    if (outcome !== "push") {
      const winnerRow = won ? rows.player : rows.dealer;
      const peak = won ? 9 : 3.5;
      pulse.position.set(0, 1.15, won ? PLAYER_Z : DEALER_Z);
      tween(
        0.1,
        0.9,
        (_, k) => {
          const wave = Math.sin(Math.PI * k);
          pulse.intensity = wave * peak;
          for (const entry of winnerRow) {
            for (const m of entry.mats) m.emissiveIntensity = wave * (won ? 0.4 : 0.15);
          }
        },
        () => {
          pulse.intensity = 0;
          for (const entry of winnerRow) for (const m of entry.mats) m.emissiveIntensity = 0;
        }
      );
    }
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
    syncRow("player", p.playerHand, -1, freshDeal ? [0, 0.3] : [0]);
    syncRow("dealer", p.dealerHand, p.holeCardHidden ? 1 : -1, freshDeal ? [0.15, 0.45] : [0]);

    // Hole-card reveal.
    if (!p.holeCardHidden) {
      const hole = rows.dealer[1];
      if (hole && hole.faceDown) flipHole(hole);
    }

    // Bet chips: toss on increase, sweep on clear/decrease.
    if (p.betChips > lastBet && (p.phase === "BETTING" || p.phase === "PLAYER")) {
      tossChips(p.betChips - lastBet); // covers per-click adds AND double-down
    } else if (p.betChips < lastBet) {
      clearBetStack();
    }
    lastBet = p.betChips;

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
    if (reduced) {
      camera.position.copy(camBase);
    } else {
      // Subtle slow sway (≈ ±0.5°) so the table feels alive.
      camera.position.set(
        camBase.x + Math.sin(now * 0.32) * 0.1,
        camBase.y + Math.sin(now * 0.21 + 1.3) * 0.045,
        camBase.z
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

  const layout = () => {
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
  const observer = new ResizeObserver(layout);
  observer.observe(mount);
  layout();
  start();

  /* ── Kick off the async glb load (procedural scene already rendering) ──── */

  try {
    new GLTFLoader().load(
      GLB_URL,
      (gltf) => {
        if (disposed) return;
        try {
          adoptGlb(gltf);
        } catch {
          /* malformed asset — the procedural table keeps running */
        }
      },
      undefined,
      () => {
        /* fetch/parse failed — the procedural table keeps running */
      }
    );
  } catch {
    /* loader unavailable — the procedural table keeps running */
  }

  /* ── Teardown: dispose EVERYTHING ─────────────────────────────────────── */

  function dispose() {
    disposed = true; // clearRow must remove instantly, never play CardDiscard
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
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
    if (glbEnv) scene.remove(glbEnv);
    glbEnv = null;
    glbChipTemplate = null;
    glbClips = null;
    for (const d of glbDisposables) d.dispose();
    glbDisposables.length = 0;
    glbChipMats.clear();
    for (const d of sharedDisposables) d.dispose();
    for (const tex of texCache.values()) tex.dispose();
    texCache.clear();
    chipMats.clear();
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
  outcome,
  reducedMotion,
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
      outcome,
      reducedMotion,
    });
  }, [playerHand, dealerHand, holeCardHidden, phase, betChips, outcome, reducedMotion]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} aria-hidden />;
}
