/**
 * lib/table-environment.ts — the jazz-bar room the Suite 7 blackjack table sits in.
 *
 * The table used to float in pure black. This module supplies the *suggestion*
 * of a room around it: a dark warm floor with a pool of light under the table,
 * an unlit curved shell for a horizon, a scatter of out-of-focus bar lights,
 * and a breath of haze in the key light. All backdrop, no scenery — the table
 * stays the hero, so nothing here is sharp, bright, or shadow-casting.
 *
 * ── Wiring it in (three lines) ─────────────────────────────────────────────
 *
 *   const env = buildTableEnvironment({ tableRadius: 5.7, tableDepth: 3.3 });
 *   scene.add(env.group);
 *   // in the rAF loop:      env.update(dt, elapsed);
 *   // on unmount:           env.dispose();
 *
 * `dispose()` releases every geometry, material and texture this module made
 * and detaches the group from its parent, so nothing else is required.
 *
 * ── Things the caller does NOT need to do ──────────────────────────────────
 * • No lights to add — the room shell is unlit by design and the two optional
 *   accent lights are self-contained and range-limited so they cannot reach
 *   the felt.
 * • No raycast filtering — every mesh here has an inert `raycast`, so the
 *   game's existing picking is unaffected.
 * • No renderer settings to change. This is built for the scene as it stands:
 *   ACES filmic tone mapping, sRGB output, PMREM RoomEnvironment, PCFSoft.
 *
 * ── Why the room is smaller than it looks like it should be ────────────────
 * The play camera sits at roughly (0, 7.25, 11.63) looking at (0, -0.20, -0.75)
 * with a 36° vertical fov. That means it is pitched ~31° down, so the top edge
 * of frame is still ~13° below the horizon and the visible floor runs out at
 * about z = -25. A backdrop further away than that is never on screen. The
 * default `roomRadius` of 18 puts the wall/floor join just inside the top of
 * frame, which is exactly where you want a horizon line. If the camera ever
 * pitches up, raise `roomRadius` and `roomHeight` together.
 */

import * as THREE from "three";
import {
  mulberry32,
  radialGlow,
  releaseTexture,
  roomBackdropTexture,
  srgbToLinear,
  verticalGradient,
} from "./table-textures";

/* ═══════════════════════════ public API ═════════════════════════════════ */

export type QualityTier = "full" | "reduced";

export interface TableEnvironment {
  /** Add this to the scene. Everything the room is made of hangs off it. */
  group: THREE.Group;
  /**
   * Advance the ambience. Call once per frame from the existing rAF loop.
   *
   * @param dt seconds since the previous frame (clamped internally, so a
   *           tab-switch spike will not lurch the animation)
   * @param t  total elapsed seconds — accepted for signature compatibility with
   *           the rest of the scene's updaters; the room integrates `dt` itself
   *           so that pausing simply means not calling `update`.
   */
  update(dt: number, t?: number): void;
  /** Switch detail tier. Cheap, but it recompiles scene shaders when the accent lights toggle, so do not call it per frame. */
  setQuality(tier: QualityTier): void;
  /** The tier currently in effect. */
  readonly quality: QualityTier;
  /** Release every geometry, material and texture, and detach `group`. Idempotent. */
  dispose(): void;
}

export interface TableEnvironmentOptions {
  /** Half-width of the table in world units (x extent). @default 5.7 */
  tableRadius?: number;
  /** Half-depth of the table in world units (z extent). @default 3.3 */
  tableDepth?: number;
  /** Freeze all motion — twinkle, drift and haze breathing. @default false */
  reducedMotion?: boolean;
  /** Starting detail tier. @default "full" */
  quality?: QualityTier;
  /** PRNG seed for the bokeh scatter. Same seed => same room. @default 1907 */
  seed?: number;
  /** Pass `renderer.capabilities.getMaxAnisotropy()` for crisper grazing angles. @default 4 */
  anisotropy?: number;

  /** Floor height. Must clear the underside of the table base. @default -1.2 */
  floorY?: number;
  /** Edge length of the floor plane. @default 150 */
  floorSize?: number;
  /** Radius of the curved backdrop shell. See the note at the top of the file. @default 18 */
  roomRadius?: number;
  /** Height of the backdrop shell. @default 13 */
  roomHeight?: number;

  /** Bokeh lights on the "full" tier. @default 34 */
  bokehCount?: number;
  /** Two dim, range-limited accent lights out in the room. @default true */
  accentLights?: boolean;
  /** Baked soft darkening under the table, independent of the real shadow map. @default true */
  contactShadow?: boolean;
  /** Haze cones descending through the key light. Always off on "reduced". @default true */
  haze?: boolean;
}

/** The geometry the room is laid out against. Useful if the caller wants to align anything to it. */
export const ENVIRONMENT_LAYOUT = {
  floorY: -1.2,
  floorSize: 150,
  roomRadius: 18,
  roomHeight: 13,
  /** Approximate far edge of visible floor for the documented play camera. */
  visibleFloorZ: -25,
} as const;

type ResolvedOptions = Required<TableEnvironmentOptions>;

/**
 * Explicit `??` resolution rather than an object spread: a caller passing an
 * explicit `undefined` (very easy to do from React props) would otherwise
 * clobber the default.
 */
function resolveOptions(options: TableEnvironmentOptions): ResolvedOptions {
  return {
    tableRadius: options.tableRadius ?? 5.7,
    tableDepth: options.tableDepth ?? 3.3,
    reducedMotion: options.reducedMotion ?? false,
    quality: options.quality ?? "full",
    seed: options.seed ?? 1907,
    anisotropy: options.anisotropy ?? 4,
    floorY: options.floorY ?? ENVIRONMENT_LAYOUT.floorY,
    floorSize: options.floorSize ?? ENVIRONMENT_LAYOUT.floorSize,
    roomRadius: options.roomRadius ?? ENVIRONMENT_LAYOUT.roomRadius,
    roomHeight: options.roomHeight ?? ENVIRONMENT_LAYOUT.roomHeight,
    bokehCount: options.bokehCount ?? 34,
    accentLights: options.accentLights ?? true,
    contactShadow: options.contactShadow ?? true,
    haze: options.haze ?? true,
  };
}

/** Palette, in the project's brand tones. */
const PALETTE = {
  gold: "#e3c071",
  goldPale: "#f7e8ac",
  goldDeep: "#b8934a",
  crimson: "#b21d3b",
  nearBlack: "#171207",
  floor: "#0b0806",
} as const;

/* ═══════════════════════ bokeh scatter (pure) ═══════════════════════════ */

export interface BokehLayoutOptions {
  count: number;
  /** No light closer to the origin than this. Keeps them clear of the play area. */
  innerRadius: number;
  outerRadius: number;
  /** Reject anything with z above this — nothing should sit between camera and table. */
  maxZ: number;
  /** Height ceiling at `innerRadius`. */
  baseHeight: number;
  /** How fast the ceiling drops per unit of extra radius (the camera's frame top slopes down). */
  heightFalloff: number;
  minHeight: number;
  seed: number;
}

export interface BokehLayout {
  /** `count * 3` world positions. */
  positions: Float32Array;
  /** `count` world-space quad sizes. */
  sizes: Float32Array;
  /** `count * 3` **linear**-space tints, ready for the shader. */
  tints: Float32Array;
  /** `count` animation phases in 0..1. */
  phases: Float32Array;
}

/** Warm bar palette in linear space: mostly amber, a few crimson, a few pale. */
const BOKEH_TINTS: ReadonlyArray<readonly [number, number, number]> = [
  [1.0, 0.68, 0.32],
  [1.0, 0.78, 0.45],
  [0.98, 0.6, 0.24],
  [1.0, 0.88, 0.62],
  [0.86, 0.22, 0.26], // crimson booth lamp
  [0.92, 0.34, 0.2],
].map(([r, g, b]) => [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)] as const);

/**
 * Scatter the distant bar lights.
 *
 * Pure and deterministic — no three.js objects, no GL — so it can be unit
 * tested. Points are placed in an annulus, kept behind/beside the table, and
 * held under a height ceiling that slopes down with distance because the play
 * camera's top-of-frame does the same.
 */
export function bokehLayout(options: BokehLayoutOptions): BokehLayout {
  const { count, innerRadius, outerRadius, maxZ, baseHeight, heightFalloff, minHeight, seed } = options;
  const rng = mulberry32(seed);

  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  const span = Math.max(0.001, outerRadius - innerRadius);

  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let z = 0;
    let r = innerRadius;

    // Rejection-sample an angle that keeps the light out of the near-camera
    // wedge. Bounded attempts, then fall back to a guaranteed-valid angle.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      r = innerRadius + Math.sqrt(rng()) * span;
      x = Math.sin(angle) * r;
      z = Math.cos(angle) * r;
      if (z <= maxZ) break;
      if (attempt === 23) {
        // Deterministic fallback: push it straight back behind the dealer.
        const fallback = (rng() - 0.5) * 1.2 + Math.PI;
        x = Math.sin(fallback) * r;
        z = Math.cos(fallback) * r;
      }
    }

    const ceiling = Math.max(minHeight + 0.25, baseHeight - heightFalloff * (r - innerRadius));
    const y = minHeight + rng() * (ceiling - minHeight);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // Bias small: a few big soft blobs read better than uniform dots.
    const roll = rng();
    sizes[i] = (0.22 + roll * roll * 0.95) * (0.75 + (0.55 * r) / outerRadius);

    const tint = BOKEH_TINTS[Math.floor(rng() * BOKEH_TINTS.length) % BOKEH_TINTS.length];
    const brightness = 0.45 + rng() * 0.55;
    tints[i * 3] = tint[0] * brightness;
    tints[i * 3 + 1] = tint[1] * brightness;
    tints[i * 3 + 2] = tint[2] * brightness;

    phases[i] = rng();
  }

  return { positions, sizes, tints, phases };
}

/* ═══════════════════════════ bokeh shader ═══════════════════════════════ */

/**
 * Camera-facing instanced quads. One draw call, and every bit of the twinkle
 * and drift happens in the vertex shader off a single `uTime` uniform, so
 * `update()` never touches a buffer or allocates.
 */
const BOKEH_VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute float iSize;
  attribute vec3 iTint;
  attribute float iPhase;

  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    float ph = iPhase * 6.28318530718;

    // Two incommensurate rates so the pattern never visibly loops.
    float twinkle = 0.70 + 0.30 * sin(uTime * 0.41 + ph) * sin(uTime * 0.157 + ph * 1.7);

    vec3 world = iOffset;
    world.y += sin(uTime * 0.083 + ph) * 0.10;
    world.x += sin(uTime * 0.061 + ph * 2.3) * 0.09;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    float s = iSize * (0.94 + 0.06 * sin(uTime * 0.21 + ph));
    mv.xy += position.xy * s;

    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = iTint * twinkle;
  }
`;

const BOKEH_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uIntensity;

  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    float a = texture2D(uMap, vUv).a;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * uIntensity, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ══════════════════════════ the builder ═════════════════════════════════ */

interface HazeEntry {
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  baseOpacity: number;
  phase: number;
  spin: number;
}

const NO_RAYCAST: THREE.Object3D["raycast"] = () => {
  /* the environment is decoration; never let it intercept the game's picking */
};

/**
 * Build the room.
 *
 * @example
 * const env = buildTableEnvironment({
 *   tableRadius: 5.7,
 *   tableDepth: 3.3,
 *   reducedMotion: prefersReducedMotion,
 *   anisotropy: renderer.capabilities.getMaxAnisotropy(),
 * });
 * scene.add(env.group);
 */
export function buildTableEnvironment(options: TableEnvironmentOptions = {}): TableEnvironment {
  const o = resolveOptions(options);

  const group = new THREE.Group();
  group.name = "TableEnvironment";

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const track = <T extends THREE.BufferGeometry>(g: T): T => (geometries.push(g), g);
  const trackMat = <T extends THREE.Material>(m: T): T => (materials.push(m), m);
  const trackTex = <T extends THREE.Texture>(t: T): T => (textures.push(t), t);

  /* ── 1. floor ─────────────────────────────────────────────────────────
   * A single huge plane. Kept slightly glossy so the PMREM RoomEnvironment
   * already in the scene does the reflection work for free — a real Reflector
   * pass would double the scene's draw cost for something that is 90% black.
   */
  const floorGeo = track(new THREE.PlaneGeometry(o.floorSize, o.floorSize));
  const floorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.floor),
      roughness: 0.44,
      metalness: 0.18,
      envMapIntensity: 0.4,
      dithering: true,
    }),
  );
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.name = "EnvFloor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = o.floorY;
  floor.receiveShadow = true;
  floor.castShadow = false;
  floor.raycast = NO_RAYCAST;
  group.add(floor);

  /* ── 1b. light pool ───────────────────────────────────────────────────
   * Additive radial gradient just above the floor, so the floor glows where
   * the table's key light lands and falls to black well before the backdrop.
   */
  const poolTex = trackTex(
    radialGlow(PALETTE.gold, PALETTE.nearBlack, 512, { falloff: 2.9, core: 0.18, anisotropy: o.anisotropy }),
  );
  const poolGeo = track(new THREE.PlaneGeometry(1, 1));
  const poolMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: poolTex,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: true,
    }),
  );
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.name = "EnvLightPool";
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, o.floorY + 0.012, -0.4);
  pool.scale.set(o.tableRadius * 5.2, o.tableDepth * 7.4, 1);
  pool.renderOrder = -3;
  pool.raycast = NO_RAYCAST;
  group.add(pool);

  /* ── 1c. contact shadow ───────────────────────────────────────────────
   * Insurance. The scene's real shadow map may or may not reach a floor this
   * far below the table, and an ungrounded table is the single most "unrendered"
   * looking thing there is. Cheap, always correct, never flickers.
   */
  if (o.contactShadow) {
    const contactTex = trackTex(
      radialGlow("#000000", "#000000", 256, { falloff: 1.9, core: 0.55, anisotropy: o.anisotropy }),
    );
    const contactMat = trackMat(
      new THREE.MeshBasicMaterial({
        map: contactTex,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        toneMapped: false,
        side: THREE.FrontSide,
      }),
    );
    const contact = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), contactMat);
    contact.name = "EnvContactShadow";
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(0, o.floorY + 0.02, -0.1);
    contact.scale.set(o.tableRadius * 2.5, o.tableDepth * 3.1, 1);
    contact.renderOrder = -2;
    contact.raycast = NO_RAYCAST;
    group.add(contact);
  }

  /* ── 2. room shell ────────────────────────────────────────────────────
   * Open-ended cylinder seen from the inside. MeshBasicMaterial on purpose:
   * an unlit material cannot be blown out by a light someone adds later, which
   * is the whole point of "atmosphere, not scenery".
   */
  const shellTex = trackTex(roomBackdropTexture({ seed: o.seed }));
  const shellGeo = track(
    new THREE.CylinderGeometry(o.roomRadius, o.roomRadius, o.roomHeight, 48, 1, true),
  );
  const shellMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: shellTex,
      side: THREE.BackSide,
      toneMapped: true,
      fog: false,
      depthWrite: true,
    }),
  );
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.name = "EnvRoomShell";
  // Sink the base slightly below the floor so there is never a seam.
  shell.position.y = o.floorY - 0.2 + o.roomHeight / 2;
  shell.raycast = NO_RAYCAST;
  group.add(shell);

  /* ── 3. distant bokeh ─────────────────────────────────────────────────
   * One InstancedBufferGeometry, one additive ShaderMaterial, one shared
   * texture: 1 draw call for the whole bar.
   */
  const fullBokeh = Math.max(0, Math.min(120, Math.round(o.bokehCount)));
  const reducedBokeh = Math.max(0, Math.round(fullBokeh * 0.5));

  const layout = bokehLayout({
    count: fullBokeh,
    innerRadius: Math.max(o.tableRadius + 3.5, 9.5),
    outerRadius: o.roomRadius - 1.5,
    maxZ: 5,
    baseHeight: 2.6,
    heightFalloff: 0.13,
    minHeight: 0.15,
    seed: o.seed,
  });

  const bokehTex = trackTex(
    radialGlow("#ffffff", "#ffffff", 128, { falloff: 2.2, core: 0.35, rim: 0.22, colorSpace: THREE.NoColorSpace }),
  );

  const bokehGeo = track(new THREE.InstancedBufferGeometry());
  // A unit quad, written by hand so nothing else owns these attribute buffers.
  bokehGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]),
      3,
    ),
  );
  bokehGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  bokehGeo.setIndex([0, 1, 2, 2, 1, 3]);
  bokehGeo.setAttribute("iOffset", new THREE.InstancedBufferAttribute(layout.positions, 3));
  bokehGeo.setAttribute("iSize", new THREE.InstancedBufferAttribute(layout.sizes, 1));
  bokehGeo.setAttribute("iTint", new THREE.InstancedBufferAttribute(layout.tints, 3));
  bokehGeo.setAttribute("iPhase", new THREE.InstancedBufferAttribute(layout.phases, 1));
  bokehGeo.instanceCount = fullBokeh;
  bokehGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), o.roomRadius + 2);

  const bokehUniforms = {
    uMap: { value: bokehTex },
    uTime: { value: 0 },
    uIntensity: { value: 1.0 },
  };
  const bokehMat = trackMat(
    new THREE.ShaderMaterial({
      uniforms: bokehUniforms,
      vertexShader: BOKEH_VERT,
      fragmentShader: BOKEH_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
      fog: false,
    }),
  );
  const bokeh = new THREE.Mesh(bokehGeo, bokehMat);
  bokeh.name = "EnvBokeh";
  bokeh.frustumCulled = false; // instance offsets move in the vertex shader
  bokeh.renderOrder = -1;
  bokeh.raycast = NO_RAYCAST;
  group.add(bokeh);

  /* ── 4. haze / god-ray suggestion ─────────────────────────────────────
   * Open cones descending from above the table. The alpha ramp reaches zero at
   * the felt, so the cloth is never washed out; what you see is the light
   * appearing to travel through air above it.
   */
  const hazes: HazeEntry[] = [];
  if (o.haze) {
    const hazeTex = trackTex(
      verticalGradient("rgba(231, 200, 132, 1)", "rgba(231, 200, 132, 0)", 256),
    );
    const cones: ReadonlyArray<{ top: number; bottom: number; h: number; x: number; z: number; op: number; spin: number }> = [
      { top: 0.8, bottom: o.tableRadius * 0.72, h: 7.4, x: 0, z: -0.3, op: 0.046, spin: 0.016 },
      { top: 0.5, bottom: o.tableRadius * 0.44, h: 6.2, x: -o.tableRadius * 0.46, z: -1.3, op: 0.03, spin: -0.011 },
    ];
    cones.forEach((c, i) => {
      const geo = track(new THREE.CylinderGeometry(c.top, c.bottom, c.h, 28, 1, true));
      const mat = trackMat(
        new THREE.MeshBasicMaterial({
          map: hazeTex,
          color: new THREE.Color(PALETTE.goldPale),
          transparent: true,
          opacity: c.op,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: true,
          fog: false,
        }),
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `EnvHaze${i}`;
      mesh.position.set(c.x, 0.04 + c.h / 2, c.z);
      mesh.renderOrder = 12;
      mesh.raycast = NO_RAYCAST;
      group.add(mesh);
      hazes.push({ mesh, material: mat, baseOpacity: c.op, phase: i * 2.1, spin: c.spin });
    });
  }

  /* ── 5. accent lights ─────────────────────────────────────────────────
   * Two dim warm lights far out in the room so the floor is not a uniform
   * black sheet. `distance` is deliberately smaller than the gap to the nearest
   * corner of the felt, so they physically cannot spill onto the play surface.
   */
  const accents: THREE.PointLight[] = [];
  if (o.accentLights) {
    const specs: ReadonlyArray<{ color: string; intensity: number; distance: number; pos: [number, number, number] }> = [
      { color: "#ffb264", intensity: 22, distance: 12, pos: [-16, 2.4, -13] },
      { color: "#8c2a34", intensity: 16, distance: 10, pos: [13, 2.2, -11] },
    ];
    for (const s of specs) {
      const light = new THREE.PointLight(new THREE.Color(s.color), s.intensity, s.distance, 2);
      light.name = "EnvAccentLight";
      light.position.set(...s.pos);
      light.castShadow = false;
      group.add(light);
      accents.push(light);
    }
  }

  /* ── runtime ─────────────────────────────────────────────────────────── */

  let quality: QualityTier = o.quality;
  let elapsed = 0;
  let disposed = false;

  function applyQuality(tier: QualityTier): void {
    quality = tier;
    const full = tier === "full";
    bokehGeo.instanceCount = full ? fullBokeh : reducedBokeh;
    bokehUniforms.uIntensity.value = full ? 1.0 : 0.85;
    for (const h of hazes) h.mesh.visible = full;
    for (const a of accents) a.visible = full;
    floorMat.metalness = full ? 0.18 : 0.0;
    floorMat.envMapIntensity = full ? 0.4 : 0.22;
    poolMat.opacity = full ? 0.42 : 0.34;
  }

  applyQuality(quality);

  const env: TableEnvironment = {
    group,

    get quality() {
      return quality;
    },

    update(dt: number) {
      if (disposed || o.reducedMotion) return;
      // Clamp so a backgrounded tab does not fast-forward the ambience.
      elapsed += dt > 0 ? Math.min(dt, 0.1) : 0;
      bokehUniforms.uTime.value = elapsed;
      for (let i = 0; i < hazes.length; i += 1) {
        const h = hazes[i];
        h.material.opacity = h.baseOpacity * (0.82 + 0.18 * Math.sin(elapsed * 0.23 + h.phase));
        h.mesh.rotation.y = elapsed * h.spin;
      }
    },

    setQuality(tier: QualityTier) {
      if (disposed || tier === quality) return;
      applyQuality(tier);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) releaseTexture(t);
      for (const a of accents) a.dispose();
      geometries.length = 0;
      materials.length = 0;
      textures.length = 0;
      accents.length = 0;
      hazes.length = 0;
    },
  };

  return env;
}
