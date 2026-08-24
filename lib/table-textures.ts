/**
 * lib/table-textures.ts — procedural CanvasTexture generators for the Suite 7 table.
 *
 * Everything here is generated on the CPU once, cached by content key, and
 * reference counted. Nothing in this file touches the DOM at import time, so it
 * is safe to import from a "use client" module that also renders on the server;
 * the generators themselves must only be called in the browser.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The felt currently reads as plastic because it is a flat colour: a perfectly
 * uniform albedo and a perfectly uniform roughness means the key light lands as
 * one clean, unbroken specular lobe. Real cloth has (a) low-frequency dye
 * mottling and (b) a high-frequency woven tooth that scatters the highlight.
 * `feltTexture()` supplies both, deliberately split across two UV scales — see
 * the note on `FeltMaps` for how to apply them.
 *
 * ── Lifetime ───────────────────────────────────────────────────────────────
 * Generators hand back *shared* textures. Never call `.dispose()` on one
 * directly. Call the matching `release()` (or `releaseTexture()`), and the
 * texture is disposed when the last holder lets go. `disposeTableTextures()`
 * force-drops the whole cache, which is what you want on a hard teardown or an
 * HMR boundary.
 */

import * as THREE from "three";

/* ───────────────────────────── shared cache ─────────────────────────────── */

interface CacheEntry {
  texture: THREE.Texture;
  refs: number;
}

const cache = new Map<string, CacheEntry>();
const keyOfTexture = new WeakMap<THREE.Texture, string>();

function acquire<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit) {
    hit.refs += 1;
    return hit.texture as T;
  }
  const texture = make();
  texture.name = texture.name || key;
  cache.set(key, { texture, refs: 1 });
  keyOfTexture.set(texture, key);
  return texture;
}

/**
 * Give back one reference to a cached texture. The texture is disposed once the
 * last reference is released. Safe to call with null/undefined, safe to call
 * with a texture this module did not create (it is ignored), and safe to call
 * more than the texture was acquired (extra calls are ignored).
 */
export function releaseTexture(texture: THREE.Texture | null | undefined): void {
  if (!texture) return;
  const key = keyOfTexture.get(texture);
  if (!key) return;
  const entry = cache.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    entry.texture.dispose();
    cache.delete(key);
    keyOfTexture.delete(texture);
  }
}

/**
 * Dispose every cached texture regardless of outstanding references and empty
 * the cache. Use on a full teardown of the 3D page (or from an HMR dispose
 * hook). After this, any surviving material still pointing at one of these
 * textures must not be rendered.
 */
export function disposeTableTextures(): void {
  for (const entry of cache.values()) entry.texture.dispose();
  cache.clear();
}

/** Number of textures currently held in the cache. Diagnostics only. */
export function cachedTextureCount(): number {
  return cache.size;
}

/* ───────────────────────────── canvas helpers ───────────────────────────── */

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error(
      "table-textures: procedural textures require a browser document; " +
        "call these generators from a client-side effect, not during SSR.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("table-textures: could not acquire a 2D canvas context.");
  return ctx;
}

function finish(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  wrap: THREE.Wrapping,
  anisotropy: number,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = colorSpace;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/* ───────────────────────────── math helpers ─────────────────────────────── */

/**
 * Deterministic, fast PRNG so every build of a texture is byte-identical.
 * Exported because `table-environment` seeds its bokeh scatter from the same
 * stream and there is no reason for two copies of it to drift apart.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** sRGB transfer function, 0..1 -> 0..1 linear. Exported for colour authoring. */
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/**
 * Seamlessly tiling value noise on a `cells x cells` lattice, sampled in
 * normalised [0,1) UV. Wraps exactly, which is what makes the felt tileable.
 */
function tileableNoise(cells: number, rng: () => number): (u: number, v: number) => number {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
  return (u: number, v: number): number => {
    const fx = u * cells;
    const fy = v * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smoothstep(fx - ix);
    const ty = smoothstep(fy - iy);
    const x0 = ((ix % cells) + cells) % cells;
    const y0 = ((iy % cells) + cells) % cells;
    const x1 = (x0 + 1) % cells;
    const y1 = (y0 + 1) % cells;
    const r0 = y0 * cells;
    const r1 = y1 * cells;
    const top = lattice[r0 + x0] + (lattice[r0 + x1] - lattice[r0 + x0]) * tx;
    const bot = lattice[r1 + x0] + (lattice[r1 + x1] - lattice[r1 + x0]) * tx;
    return top + (bot - top) * ty;
  };
}

/**
 * Colour -> 0..255 **sRGB** triplet, i.e. the byte values a canvas expects.
 *
 * `THREE.Color` stores linear-sRGB internally (ColorManagement is on by
 * default in r152+), so reading `.r/.g/.b` straight would write linear values
 * into an sRGB buffer and wash everything out. `getHex(SRGBColorSpace)` does
 * the encode for us.
 */
function rgb255(color: THREE.ColorRepresentation): [number, number, number] {
  const hex = new THREE.Color(color).getHex(THREE.SRGBColorSpace);
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/* ═══════════════════════════════ felt ═══════════════════════════════════ */

export interface FeltOptions {
  /**
   * Texture edge of all three maps. Clamped to [256, 1024].
   *
   * Measured build cost for the whole set: ~45ms at 512, ~185ms at 1024. 512 is
   * the sweet spot — at the play camera the extra 1024 detail is sub-pixel, so
   * you pay four times the hitch for something mipmapping averages away.
   *
   * Note that `threads` is additionally clamped to `size / 4`, so dropping to
   * 256 also halves the thread count; raise `detailRepeat` to compensate if you
   * do that.
   * @default 512
   */
  size?: number;
  /**
   * Woven threads across one tile of the detail maps. More threads = finer
   * cloth. Must stay above ~4 pixels per thread or the normal map aliases.
   * @default 96
   */
  threads?: number;
  /**
   * Baked tone for `map`. Leave undefined (the default) for a **tintable**
   * near-white weave whose mean luminance is 1.0 — you keep your existing
   * `material.color` (e.g. the felt `#0d0a06`) and the map only modulates it.
   * Set a colour here to bake the tone into the texture instead, in which case
   * `material.color` must be white.
   */
  baseColor?: THREE.ColorRepresentation;
  /**
   * Strength of the low-frequency dye mottling in `map`, 0..1, measured in sRGB
   * output. Note that sRGB decoding roughly doubles the swing in linear space,
   * so 0.11 already reads as ~20% variation on the felt. @default 0.11
   */
  mottle?: number;
  /** Height amplitude fed to the normal map, 0..2. @default 1 */
  relief?: number;
  /** PRNG seed; same seed => same texture (and same cache entry). @default 7 */
  seed?: number;
  /** Texture anisotropy. Pass `renderer.capabilities.getMaxAnisotropy()`. @default 8 */
  anisotropy?: number;
}

export interface FeltMaps {
  /**
   * Albedo modulation: low-frequency dye mottling plus a whisper of weave.
   * Apply at the COARSE repeat (`mapRepeat`) — this is the map that actually
   * reads on screen at the table camera.
   */
  map: THREE.Texture;
  /** Absolute roughness (not a multiplier scale — set `material.roughness = 1`). Apply at `detailRepeat`. */
  roughnessMap: THREE.Texture;
  /** Tangent-space weave normals. Apply at `detailRepeat`. */
  normalMap: THREE.Texture;

  /**
   * Repeat for `map` assuming the felt's UV 0..1 spans the full ~11.4-unit
   * table surface. One tile ≈ 3.8 world units, so the mottling reads as broad
   * unevenness rather than a pattern.
   */
  mapRepeat: number;
  /**
   * Repeat for `normalMap` + `roughnessMap` on the same UV assumption. One tile
   * ≈ 1.14 world units across 96 threads => ~12mm of cloth per thread at table
   * scale, which lands at roughly 1.5 screen pixels from the play camera: fine
   * enough to read as tooth, coarse enough to survive mipmapping.
   *
   * Raise toward 20 for a sleeker, more casino-perfect felt; drop toward 6 for
   * visible baize tooth.
   */
  detailRepeat: number;
  /** Suggested uniform `normalScale`. Cloth wants this low. */
  normalScale: number;

  /**
   * Mean **linear** gain of `map` (≈0.85). The mottling only ever darkens —
   * there is no headroom above 1.0 in an 8-bit sRGB texture, and clipping the
   * bright half would flatten exactly the variation we are adding — so the felt
   * ends up this much darker on average.
   *
   * Divide `material.color` by this to keep the felt's original brightness.
   * `applyFeltMaps()` does it for you unless you opt out.
   */
  mapMeanGain: number;

  /** Release all three textures back to the shared cache. Idempotent-ish (see `releaseTexture`). */
  release(): void;
}

const FELT_DEFAULTS = {
  size: 512,
  threads: 96,
  mottle: 0.11,
  relief: 1,
  seed: 7,
  anisotropy: 8,
} as const;

/** Coarse repeat for the albedo/mottle map at the table's ~11.4-unit scale. */
export const FELT_MAP_REPEAT = 3;
/** Fine repeat for the weave normal/roughness maps at the table's ~11.4-unit scale. */
export const FELT_DETAIL_REPEAT = 10;
/** Suggested `material.normalScale` magnitude for the felt weave. */
export const FELT_NORMAL_SCALE = 0.38;

function feltKey(prefix: string, o: Required<Omit<FeltOptions, "baseColor">> & { baseColor: string }): string {
  return `${prefix}|${o.size}|${o.threads}|${o.mottle}|${o.relief}|${o.seed}|${o.anisotropy}|${o.baseColor}`;
}

/**
 * Woven-cloth maps for the felt surface.
 *
 * Returns three cached textures plus the repeats that make them read correctly
 * at the table's scale. See `applyFeltMaps()` for the one-call version.
 *
 * @example
 * const felt = feltTexture({ anisotropy: renderer.capabilities.getMaxAnisotropy() });
 * mat.map = felt.map;              mat.map.repeat.setScalar(felt.mapRepeat);
 * mat.normalMap = felt.normalMap;  mat.normalMap.repeat.setScalar(felt.detailRepeat);
 * // ...later
 * felt.release();
 */
export function feltTexture(options: FeltOptions = {}): FeltMaps {
  const size = Math.max(256, Math.min(1024, Math.round(options.size ?? FELT_DEFAULTS.size)));
  const threads = Math.max(16, Math.min(size >> 2, Math.round(options.threads ?? FELT_DEFAULTS.threads)));
  const mottle = clamp01(options.mottle ?? FELT_DEFAULTS.mottle);
  const relief = Math.max(0, Math.min(2, options.relief ?? FELT_DEFAULTS.relief));
  const seed = options.seed ?? FELT_DEFAULTS.seed;
  const anisotropy = Math.max(1, Math.round(options.anisotropy ?? FELT_DEFAULTS.anisotropy));
  const baseColor = options.baseColor === undefined ? "tintable" : new THREE.Color(options.baseColor).getHexString();

  const resolved = { size, threads, mottle, relief, seed, anisotropy, baseColor };

  // The three maps share one height field, so build it once and memoise the
  // derived canvases under their own keys.
  let shared: FeltFields | null = null;
  const fields = (): FeltFields => (shared ??= buildFeltFields(size, threads, seed));

  const albedoKey = feltKey("felt:albedo", resolved);
  const map = acquire(albedoKey, () => {
    const built = feltAlbedoCanvas(fields(), mottle, options.baseColor);
    albedoMeanGain.set(albedoKey, built.meanGain);
    return finish(built.canvas, THREE.SRGBColorSpace, THREE.RepeatWrapping, anisotropy);
  });
  const roughnessMap = acquire(feltKey("felt:rough", resolved), () =>
    finish(feltRoughnessCanvas(fields()), THREE.NoColorSpace, THREE.RepeatWrapping, anisotropy),
  );
  const normalMap = acquire(feltKey("felt:normal", resolved), () =>
    finish(feltNormalCanvas(fields(), relief), THREE.NoColorSpace, THREE.RepeatWrapping, anisotropy),
  );

  return {
    map,
    roughnessMap,
    normalMap,
    mapRepeat: FELT_MAP_REPEAT,
    detailRepeat: FELT_DETAIL_REPEAT,
    normalScale: FELT_NORMAL_SCALE,
    mapMeanGain: albedoMeanGain.get(albedoKey) ?? 1,
    release() {
      releaseTexture(map);
      releaseTexture(roughnessMap);
      releaseTexture(normalMap);
    },
  };
}

interface FeltFields {
  size: number;
  /** Weave height, 0..1, one float per texel. */
  height: Float32Array;
  /** Low-frequency dye mottling, 0..1. */
  mottle: Float32Array;
  /** Mid-frequency fibre clumping, 0..1. */
  fibre: Float32Array;
}

/**
 * Build the height / mottle / fibre fields for one felt tile.
 *
 * All per-axis trigonometry is hoisted into two lookup tables so the inner loop
 * is pure arithmetic — the whole thing lands around 30-40ms at 512².
 */
function buildFeltFields(size: number, threads: number, seed: number): FeltFields {
  const rng = mulberry32(seed);
  const noiseMottle = tileableNoise(6, rng);
  const noiseFibreA = tileableNoise(48, rng);
  const noiseFibreB = tileableNoise(120, rng);

  // Rounded thread cross-section + which thread this texel belongs to.
  const profile = new Float32Array(size);
  const parity = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    const u = (i + 0.5) / size;
    profile[i] = Math.pow(Math.abs(Math.sin(Math.PI * threads * u)), 0.65);
    parity[i] = Math.floor(threads * u) & 1;
  }

  const height = new Float32Array(size * size);
  const mottle = new Float32Array(size * size);
  const fibre = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    const weft = profile[y];
    const py = parity[y];
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const warp = profile[x];
      // Plain weave: alternate which thread family sits on top per cell.
      const warpOnTop = (py ^ parity[x]) === 0;
      const woven = warpOnTop ? warp * 0.86 + weft * 0.14 : weft * 0.86 + warp * 0.14;

      const f = noiseFibreA(u, v) * 0.62 + noiseFibreB(u, v) * 0.38;
      const m = noiseMottle(u, v);

      const i = row + x;
      // Fibre noise both perturbs the thread height and frays its edges.
      height[i] = clamp01(woven * (0.78 + 0.30 * f) + (f - 0.5) * 0.14);
      mottle[i] = m;
      fibre[i] = f;
    }
  }

  return { size, height, mottle, fibre };
}

/** Cached mean linear gain per albedo cache key. Deterministic, so never stale. */
const albedoMeanGain = new Map<string, number>();

const WEAVE_TINT = 0.03;
const FIBRE_TINT = 0.018;

/**
 * Albedo: dominated by low-frequency dye mottling with a slight warm/cool hue
 * shift (pure luminance variation on a near-black felt bands badly in 8 bit),
 * plus a token amount of weave so close-ups have grain.
 *
 * The modulation is strictly **downward** from 1.0. An 8-bit texture has no
 * headroom above white, so a symmetric ±amplitude would clip its entire bright
 * half flat — destroying exactly the variation this map exists to add. Going
 * one-sided keeps every step of the mottling and costs only a uniform darkening
 * that the caller compensates for once, via `mapMeanGain`.
 */
function feltAlbedoCanvas(
  fields: FeltFields,
  mottleAmount: number,
  baseColor: THREE.ColorRepresentation | undefined,
): { canvas: HTMLCanvasElement; meanGain: number } {
  const { size, height, mottle, fibre } = fields;
  const canvas = createCanvas(size, size);
  const ctx = context2d(canvas);
  const image = ctx.createImageData(size, size);
  const data = image.data;

  // Tintable mode leaves the weave near white so it multiplies cleanly against
  // whatever `material.color` already is. Baked mode multiplies into a tone.
  const [br, bg, bb] = baseColor === undefined ? [255, 255, 255] : rgb255(baseColor);

  // Histogram the 8-bit luminance rather than calling srgbToLinear per texel:
  // 256 pow() calls at the end instead of a quarter of a million in the loop.
  const histogram = new Uint32Array(256);

  for (let i = 0, p = 0; i < height.length; i += 1, p += 4) {
    const m = mottle[i]; // 0..1
    const w = height[i];
    const f = fibre[i];

    const lum = 1 - mottleAmount * (1 - m) - WEAVE_TINT * (1 - w) - FIBRE_TINT * (1 - f);
    // Warm where the dye pooled, a touch cooler where it thinned.
    const warm = (m - 0.5) * mottleAmount * 0.9;

    histogram[(clamp01(lum) * 255) | 0] += 1;

    data[p] = clamp01(lum * (1 + warm)) * br;
    data[p + 1] = clamp01(lum) * bg;
    data[p + 2] = clamp01(lum * (1 - warm * 0.8)) * bb;
    data[p + 3] = 255;
  }

  let gainSum = 0;
  for (let b = 0; b < 256; b += 1) {
    if (histogram[b] !== 0) gainSum += srgbToLinear(b / 255) * histogram[b];
  }

  ctx.putImageData(image, 0, 0);
  return { canvas, meanGain: gainSum / height.length };
}

/**
 * Roughness: absolute values, not a multiplier — set `material.roughness = 1`.
 * Thread crowns are very slightly compacted (smoother); the valleys between
 * threads trap light and read rougher.
 */
function feltRoughnessCanvas(fields: FeltFields): HTMLCanvasElement {
  const { size, height, mottle, fibre } = fields;
  const canvas = createCanvas(size, size);
  const ctx = context2d(canvas);
  const image = ctx.createImageData(size, size);
  const data = image.data;

  // Coefficients chosen so the extremes land just inside [0.78, 1.0] — a
  // roughness map that clips at 1.0 loses the thread-valley detail entirely.
  for (let i = 0, p = 0; i < height.length; i += 1, p += 4) {
    const r = clamp01(0.89 - (height[i] - 0.5) * 0.12 + (fibre[i] - 0.5) * 0.05 + (mottle[i] - 0.5) * 0.04);
    const v = r * 255;
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Tangent-space normals from the height field, sampled with wraparound so the
 * tile stays seamless. Green points along +v (OpenGL convention, which is what
 * three.js expects).
 */
function feltNormalCanvas(fields: FeltFields, relief: number): HTMLCanvasElement {
  const { size, height } = fields;
  const canvas = createCanvas(size, size);
  const ctx = context2d(canvas);
  const image = ctx.createImageData(size, size);
  const data = image.data;

  // Tuned so the steepest thread edge tilts ~20° off vertical. Steeper than
  // that and the map aliases into noise the moment mipmapping kicks in, which
  // at this camera distance is immediately.
  const strength = 0.85 * relief;

  for (let y = 0; y < size; y += 1) {
    const rowUp = ((y - 1 + size) % size) * size;
    const rowDown = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;

      // Canvas rows run downward; texture v runs upward (flipY), hence the sign.
      const dhdu = height[row + xr] - height[row + xl];
      const dhdv = height[rowUp + x] - height[rowDown + x];

      let nx = -dhdu * strength;
      let ny = -dhdv * strength;
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv;
      ny *= inv;

      const p = (row + x) * 4;
      data[p] = (nx * 0.5 + 0.5) * 255;
      data[p + 1] = (ny * 0.5 + 0.5) * 255;
      data[p + 2] = (nz * inv * 0.5 + 0.5) * 255;
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/* ──────────────────────────── planar UVs ────────────────────────────────── */

export interface PlanarUVOptions {
  /** Which pair of local axes forms the UV plane. @default "xz" (a flat table top) */
  plane?: "xz" | "xy" | "zy";
  /**
   * Use one scale for both axes so texels stay square. Without this, a felt
   * that is 5.5 long and 3.0 deep would stretch the weave 1.8x along one axis.
   * @default true
   */
  uniform?: boolean;
  /** Rebuild even when the geometry already has usable UVs. @default false */
  force?: boolean;
}

export interface PlanarUVResult {
  /** `"kept"` means the geometry already had usable UVs and nothing was touched. */
  status: "created" | "replaced" | "kept";
  /**
   * Local-space distance that one UV unit spans. Multiply by the mesh's world
   * scale to convert the `repeat` values into world units.
   */
  unitSize: number;
}

/**
 * Give a geometry flat, box-projected UVs — and, crucially, replace UVs that
 * are *present but degenerate*.
 *
 * ⚠️ This is not optional for the Suite 7 felt. The `S7_Felt` primitive in
 * `table-assets.glb` ships a TEXCOORD_0 in which **every one of its 652
 * vertices sits at (0, 1)**. Any map assigned to that material samples a single
 * texel and comes out a perfectly flat colour — which is precisely why the felt
 * reads as plastic today, and why simply assigning the cloth maps would change
 * nothing at all.
 *
 * Writes into the existing attribute buffer when the shape allows, so no GPU
 * buffer is orphaned. Best called right after the GLB loads, before first
 * render.
 *
 * @example
 * table.traverse((o) => {
 *   const mesh = o as THREE.Mesh;
 *   const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
 *   if (mat?.name === "S7_Felt") ensurePlanarUVs(mesh.geometry);
 * });
 */
export function ensurePlanarUVs(
  geometry: THREE.BufferGeometry,
  options: PlanarUVOptions = {},
): PlanarUVResult {
  const plane = options.plane ?? "xz";
  const uniform = options.uniform ?? true;

  const position = geometry.getAttribute("position");
  if (!position) return { status: "kept", unitSize: 1 };

  const count = position.count;
  const axisA = plane === "zy" ? 2 : 0;
  const axisB = plane === "xy" ? 1 : plane === "zy" ? 1 : 2;

  const existing = geometry.getAttribute("uv");
  if (existing && !options.force) {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < existing.count; i += 1) {
      const u = existing.getX(i);
      const v = existing.getY(i);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    // A collapsed range in either axis means the mapping carries no information.
    if (maxU - minU > 1e-6 && maxV - minV > 1e-6) {
      return { status: "kept", unitSize: 1 };
    }
  }

  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const a = position.getComponent(i, axisA);
    const b = position.getComponent(i, axisB);
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  const spanA = Math.max(1e-6, maxA - minA);
  const spanB = Math.max(1e-6, maxB - minB);
  const scaleA = uniform ? Math.max(spanA, spanB) : spanA;
  const scaleB = uniform ? Math.max(spanA, spanB) : spanB;

  // Reuse the existing buffer when it is the right shape — replacing the
  // attribute outright would strand its GPU buffer until the geometry is
  // disposed.
  const reusable =
    existing !== undefined &&
    existing.itemSize === 2 &&
    existing.count === count &&
    existing.array instanceof Float32Array &&
    !(existing as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;

  const target = reusable ? (existing.array as Float32Array) : new Float32Array(count * 2);

  for (let i = 0; i < count; i += 1) {
    target[i * 2] = (position.getComponent(i, axisA) - minA) / scaleA;
    target[i * 2 + 1] = (position.getComponent(i, axisB) - minB) / scaleB;
  }

  if (reusable && existing) {
    existing.needsUpdate = true;
  } else {
    geometry.setAttribute("uv", new THREE.BufferAttribute(target, 2));
  }

  return { status: existing ? "replaced" : "created", unitSize: uniform ? Math.max(spanA, spanB) : spanA };
}

/* ─────────────────────── one-call felt application ──────────────────────── */

export interface ApplyFeltOptions extends FeltOptions {
  /** Override the coarse albedo repeat. @default FELT_MAP_REPEAT (3) */
  mapRepeat?: number;
  /** Override the fine weave repeat. @default FELT_DETAIL_REPEAT (10) */
  detailRepeat?: number;
  /**
   * Felt tone written to `material.color`. Omit to keep whatever colour the
   * material already has (the usual case — the GLB already carries it).
   */
  feltColor?: THREE.ColorRepresentation;
  /**
   * If the material is a MeshPhysicalMaterial, enable its cloth sheen lobe.
   * Ignored on a plain MeshStandardMaterial. @default true
   */
  sheen?: boolean;
  /** Magnitude for `material.normalScale`. @default FELT_NORMAL_SCALE (0.38) */
  normalScale?: number;
  /**
   * Compensate `material.color` for the albedo map's mean darkening so the felt
   * keeps the exact brightness it had before the maps went on. See
   * `FeltMaps.mapMeanGain`. @default true
   */
  preserveBrightness?: boolean;
  /**
   * The felt geometry. When given, `ensurePlanarUVs()` runs on it first — which
   * the Suite 7 felt *requires*, since its shipped UVs are degenerate.
   */
  geometry?: THREE.BufferGeometry;
}

/**
 * Turn a flat felt material into cloth in one call.
 *
 * Sets `map` / `roughnessMap` / `normalMap` with the correct per-texture
 * repeats and colour spaces, forces `roughness = 1` (the roughness map carries
 * absolute values), zeroes metalness, and — on a MeshPhysicalMaterial — dials
 * in a warm sheen lobe.
 *
 * The `map` is generated in **tintable** mode by default, so the material's
 * existing `color` (e.g. the felt `#0d0a06`) is preserved and merely modulated;
 * `color` is also nudged up to cancel the map's mean darkening, so the felt
 * ends up the same average brightness it started at, just no longer flat. Any
 * `map` the material already had is replaced.
 *
 * **Pass `geometry`.** The Suite 7 felt primitive ships degenerate UVs — every
 * vertex at (0, 1) — so without `ensurePlanarUVs` every map below samples a
 * single texel and this entire call is a no-op. Passing the geometry runs that
 * fix first.
 *
 * @example
 * const stop = applyFeltMaps(feltMesh.material as THREE.MeshStandardMaterial, {
 *   geometry: feltMesh.geometry,
 *   anisotropy: renderer.capabilities.getMaxAnisotropy(),
 * });
 *
 * @returns a cleanup function that releases the shared textures and restores
 *          `color`. Call it from the same place you dispose the rest of the
 *          scene. It clears the maps rather than restoring any previous ones.
 */
export function applyFeltMaps(
  material: THREE.MeshStandardMaterial,
  options: ApplyFeltOptions = {},
): () => void {
  if (options.geometry) ensurePlanarUVs(options.geometry);

  const felt = feltTexture(options);

  const mapRepeat = options.mapRepeat ?? felt.mapRepeat;
  const detailRepeat = options.detailRepeat ?? felt.detailRepeat;
  const normalScale = options.normalScale ?? felt.normalScale;

  // Per-texture UV transforms: three.js gives `map`, `normalMap` and
  // `roughnessMap` independent transform uniforms, which is what lets the
  // mottling live at one scale and the weave at another.
  felt.map.repeat.setScalar(mapRepeat);
  felt.roughnessMap.repeat.setScalar(detailRepeat);
  felt.normalMap.repeat.setScalar(detailRepeat);

  material.map = felt.map;
  material.roughnessMap = felt.roughnessMap;
  material.normalMap = felt.normalMap;
  material.normalScale.set(normalScale, normalScale);
  material.roughness = 1;
  material.metalness = 0;

  const previousColor = material.color.clone();
  if (options.feltColor !== undefined) material.color.set(options.feltColor);
  if ((options.preserveBrightness ?? true) && felt.mapMeanGain > 0.01) {
    // Color is stored linear, and mapMeanGain is a linear gain, so this is a
    // straight division in the right space.
    material.color.multiplyScalar(1 / felt.mapMeanGain);
  }

  // Cloth sheen, when the material supports it. Feature-detected so this works
  // whether the GLB gave us Standard or Physical.
  const physical = material as Partial<THREE.MeshPhysicalMaterial>;
  if ((options.sheen ?? true) && typeof physical.sheen === "number") {
    physical.sheen = 0.35;
    physical.sheenRoughness = 0.9;
    physical.sheenColor?.set("#4a3a24");
  }

  material.needsUpdate = true;

  return () => {
    if (material.map === felt.map) material.map = null;
    if (material.roughnessMap === felt.roughnessMap) material.roughnessMap = null;
    if (material.normalMap === felt.normalMap) material.normalMap = null;
    material.color.copy(previousColor);
    material.needsUpdate = true;
    felt.release();
  };
}

/* ═══════════════════════════ radial glow ════════════════════════════════ */

export interface RadialGlowOptions {
  /**
   * Alpha falloff exponent. 1 = linear cone, 2-3 = soft bloom, 5+ = tight core.
   * @default 2.4
   */
  falloff?: number;
  /** Extra alpha piled into the very centre, 0..1. @default 0.25 */
  core?: number;
  /**
   * Defocused-lens rim brightening, 0..1. A little of this is what makes bokeh
   * read as bokeh rather than as a blur. @default 0
   */
  rim?: number;
  /** Texture colour space. Leave default for colour maps. @default SRGBColorSpace */
  colorSpace?: THREE.ColorSpace;
  /**
   * Anisotropy. Worth raising for a glow laid flat on the floor, which the play
   * camera always sees at a grazing angle. @default 1
   */
  anisotropy?: number;
}

/**
 * Soft radial gradient with a straight (non-premultiplied) alpha ramp.
 *
 * Used for the bokeh sprites, the floor light pool and the contact shadow. Hand
 * back with `releaseTexture()`.
 *
 * @param colorInner colour at the centre
 * @param colorOuter colour at the rim (alpha reaches 0 there regardless)
 * @param size       texture edge, clamped to [32, 512]. @default 256
 */
export function radialGlow(
  colorInner: THREE.ColorRepresentation,
  colorOuter: THREE.ColorRepresentation,
  size = 256,
  options: RadialGlowOptions = {},
): THREE.Texture {
  const s = Math.max(32, Math.min(512, Math.round(size)));
  const falloff = Math.max(0.2, options.falloff ?? 2.4);
  const core = clamp01(options.core ?? 0.25);
  const rim = clamp01(options.rim ?? 0);
  const colorSpace = options.colorSpace ?? THREE.SRGBColorSpace;
  const anisotropy = Math.max(1, Math.round(options.anisotropy ?? 1));

  const inner = new THREE.Color(colorInner).getHexString();
  const outer = new THREE.Color(colorOuter).getHexString();
  const key = `glow|${s}|${falloff}|${core}|${rim}|${inner}|${outer}|${colorSpace}|${anisotropy}`;

  return acquire(key, () => {
    const canvas = createCanvas(s, s);
    const ctx = context2d(canvas);
    const image = ctx.createImageData(s, s);
    const data = image.data;

    const [ir, ig, ib] = rgb255(colorInner);
    const [or_, og, ob] = rgb255(colorOuter);
    const c = (s - 1) / 2;
    const invR = 1 / c;

    for (let y = 0; y < s; y += 1) {
      const dy = (y - c) * invR;
      for (let x = 0; x < s; x += 1) {
        const dx = (x - c) * invR;
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const t = 1 - r;

        let a = Math.pow(t, falloff);
        if (core > 0) a += core * Math.pow(t, falloff * 4);
        if (rim > 0) {
          const band = smoothstep(clamp01((r - 0.5) / 0.32)) * (1 - smoothstep(clamp01((r - 0.82) / 0.18)));
          a *= 1 + rim * band;
        }

        const p = (y * s + x) * 4;
        data[p] = ir + (or_ - ir) * r;
        data[p + 1] = ig + (og - ig) * r;
        data[p + 2] = ib + (ob - ib) * r;
        data[p + 3] = clamp01(a) * 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    return finish(canvas, colorSpace, THREE.ClampToEdgeWrapping, anisotropy);
  });
}

/* ════════════════════════ vertical gradient ═════════════════════════════ */

/**
 * Two-stop vertical gradient, `top` at v = 1 and `bottom` at v = 0.
 *
 * Accepts any CSS colour string, **including rgba()** — an alpha ramp is what
 * the god-ray cones want (keep the RGB constant between the two stops so the
 * unpremultiplied canvas readback does not bleed).
 *
 * @param size texture height, clamped to [16, 1024]. @default 256
 */
export function verticalGradient(top: string, bottom: string, size = 256): THREE.Texture {
  const h = Math.max(16, Math.min(1024, Math.round(size)));
  const key = `vgrad|${h}|${top}|${bottom}`;
  return acquire(key, () => {
    const canvas = createCanvas(4, h);
    const ctx = context2d(canvas);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, top); // canvas row 0 -> v = 1 with the default flipY
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, h);
    const texture = finish(canvas, THREE.SRGBColorSpace, THREE.ClampToEdgeWrapping, 1);
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  });
}

/* ═════════════════════════ room backdrop ════════════════════════════════ */

export interface RoomBackdropOptions {
  /** Texture width (wraps around the shell). @default 512 */
  width?: number;
  /** Texture height. @default 256 */
  height?: number;
  /** Number of soft wall-sconce pools. @default 7 */
  sconces?: number;
  /** Sconce tint. @default "#c98b3a" */
  sconceColor?: string;
  /** PRNG seed. @default 21 */
  seed?: number;
}

/**
 * The unlit-room backdrop: a warm brown-black vertical ramp (darkest at the
 * top, exactly as a room with no ceiling light behaves) with a handful of very
 * dim sconce pools smeared across the lower band.
 *
 * The lower band matters because at the table camera only the bottom couple of
 * world-units of the shell are ever in frame — see `buildTableEnvironment`.
 *
 * Meant for a `MeshBasicMaterial`: the backdrop must never be lit, or a stray
 * key light will turn atmosphere into scenery.
 */
export function roomBackdropTexture(options: RoomBackdropOptions = {}): THREE.Texture {
  const w = Math.max(64, Math.min(1024, Math.round(options.width ?? 512)));
  const h = Math.max(64, Math.min(1024, Math.round(options.height ?? 256)));
  const sconces = Math.max(0, Math.min(24, Math.round(options.sconces ?? 7)));
  const sconceColor = options.sconceColor ?? "#c98b3a";
  const seed = options.seed ?? 21;

  const key = `backdrop|${w}|${h}|${sconces}|${sconceColor}|${seed}`;

  return acquire(key, () => {
    const canvas = createCanvas(w, h);
    const ctx = context2d(canvas);

    // Canvas row 0 is the top of the shell (v = 1).
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, "#040302"); // ceiling — effectively black
    grad.addColorStop(0.55, "#0a0705");
    grad.addColorStop(0.78, "#150e08"); // the warm band a jazz bar has at eye level
    grad.addColorStop(0.9, "#1c1209");
    grad.addColorStop(1.0, "#080503"); // skirting, back to dark to meet the floor
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Dim sconce pools, additively composited into the lower band.
    const rng = mulberry32(seed);
    ctx.globalCompositeOperation = "lighter";
    const [sr, sg, sb] = rgb255(sconceColor);
    for (let i = 0; i < sconces; i += 1) {
      const x = ((i + rng() * 0.7) / sconces) * w;
      const y = h * (0.72 + rng() * 0.18);
      const r = w * (0.045 + rng() * 0.055);
      const a = 0.1 + rng() * 0.14;
      const pool = ctx.createRadialGradient(x, y, 0, x, y, r);
      pool.addColorStop(0, `rgba(${sr}, ${sg}, ${sb}, ${a})`);
      pool.addColorStop(1, `rgba(${sr}, ${sg}, ${sb}, 0)`);
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // Wrap the pool around the seam so the cylinder has no visible join.
      if (x < r) {
        ctx.translate(w, 0);
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    ctx.globalCompositeOperation = "source-over";

    const texture = finish(canvas, THREE.SRGBColorSpace, THREE.RepeatWrapping, 1);
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  });
}
