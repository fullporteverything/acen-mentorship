/**
 * Pure-math tests for the table environment.
 *
 * Deliberately scoped to `bokehLayout`, the only piece of this module that is
 * testable without a GL context — everything else in `table-environment.ts`
 * builds three.js objects and CanvasTextures, which need a browser/WebGL.
 * Importing the module here is still safe: nothing touches the DOM at import
 * time.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { bokehLayout, ENVIRONMENT_LAYOUT, type BokehLayoutOptions } from "./table-environment";
import { ensurePlanarUVs } from "./table-textures";

const OPTS: BokehLayoutOptions = {
  count: 34,
  innerRadius: 9.5,
  outerRadius: 16.5,
  maxZ: 5,
  baseHeight: 2.6,
  heightFalloff: 0.13,
  minHeight: 0.15,
  seed: 1907,
};

describe("bokehLayout", () => {
  it("fills every buffer to the requested count", () => {
    const l = bokehLayout(OPTS);
    expect(l.positions).toHaveLength(OPTS.count * 3);
    expect(l.tints).toHaveLength(OPTS.count * 3);
    expect(l.sizes).toHaveLength(OPTS.count);
    expect(l.phases).toHaveLength(OPTS.count);
  });

  it("keeps every light inside the annulus", () => {
    const l = bokehLayout(OPTS);
    for (let i = 0; i < OPTS.count; i += 1) {
      const x = l.positions[i * 3];
      const z = l.positions[i * 3 + 2];
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(OPTS.innerRadius - 1e-6);
      expect(r).toBeLessThanOrEqual(OPTS.outerRadius + 1e-6);
    }
  });

  it("never places a light between the camera and the table", () => {
    const l = bokehLayout({ ...OPTS, count: 400 });
    for (let i = 0; i < 400; i += 1) {
      expect(l.positions[i * 3 + 2]).toBeLessThanOrEqual(OPTS.maxZ + 1e-6);
    }
  });

  it("never places a light over the play area", () => {
    const tableRadius = 5.7;
    const tableDepth = 3.3;
    const l = bokehLayout({ ...OPTS, count: 400 });
    for (let i = 0; i < 400; i += 1) {
      const x = l.positions[i * 3];
      const z = l.positions[i * 3 + 2];
      expect(Math.abs(x) > tableRadius || Math.abs(z) > tableDepth).toBe(true);
    }
  });

  it("holds every light under the camera's sloping top-of-frame", () => {
    const l = bokehLayout({ ...OPTS, count: 400 });
    for (let i = 0; i < 400; i += 1) {
      const x = l.positions[i * 3];
      const y = l.positions[i * 3 + 1];
      const z = l.positions[i * 3 + 2];
      const r = Math.hypot(x, z);
      const ceiling = Math.max(
        OPTS.minHeight + 0.25,
        OPTS.baseHeight - OPTS.heightFalloff * (r - OPTS.innerRadius),
      );
      expect(y).toBeGreaterThanOrEqual(OPTS.minHeight - 1e-6);
      expect(y).toBeLessThanOrEqual(ceiling + 1e-6);
    }
  });

  it("emits finite, positive sizes and non-negative linear tints", () => {
    const l = bokehLayout(OPTS);
    for (let i = 0; i < OPTS.count; i += 1) {
      expect(Number.isFinite(l.sizes[i])).toBe(true);
      expect(l.sizes[i]).toBeGreaterThan(0);
      expect(l.phases[i]).toBeGreaterThanOrEqual(0);
      expect(l.phases[i]).toBeLessThan(1);
    }
    for (let i = 0; i < l.tints.length; i += 1) {
      expect(l.tints[i]).toBeGreaterThanOrEqual(0);
      expect(l.tints[i]).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic per seed and varies across seeds", () => {
    expect(Array.from(bokehLayout(OPTS).positions)).toEqual(
      Array.from(bokehLayout(OPTS).positions),
    );
    expect(Array.from(bokehLayout({ ...OPTS, seed: 42 }).positions)).not.toEqual(
      Array.from(bokehLayout(OPTS).positions),
    );
  });

  it("degrades gracefully at count 0", () => {
    const l = bokehLayout({ ...OPTS, count: 0 });
    expect(l.positions).toHaveLength(0);
    expect(l.sizes).toHaveLength(0);
  });
});

/**
 * `ensurePlanarUVs` is plain BufferGeometry arithmetic — no GL, no canvas — so
 * it belongs here rather than in a browser test.
 */
describe("ensurePlanarUVs", () => {
  /** A flat quad in the XZ plane, matching the felt's proportions (5.48 x 2.98). */
  function feltLikeGeometry(uv?: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        // prettier-ignore
        new Float32Array([
          -2.74, 0, -1.49,
           2.74, 0, -1.49,
          -2.74, 0,  1.49,
           2.74, 0,  1.49,
        ]),
        3,
      ),
    );
    if (uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
    return g;
  }

  it("replaces the collapsed UVs the Suite 7 felt actually ships", () => {
    // Every vertex at (0, 1) — this is verbatim what S7_Felt contains.
    const g = feltLikeGeometry([0, 1, 0, 1, 0, 1, 0, 1]);
    const result = ensurePlanarUVs(g);
    expect(result.status).toBe("replaced");

    const uv = g.getAttribute("uv");
    const us = [uv.getX(0), uv.getX(1), uv.getX(2), uv.getX(3)];
    const vs = [uv.getY(0), uv.getY(1), uv.getY(2), uv.getY(3)];
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.5);
    expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(0.1);
  });

  it("keeps square texels, so the weave does not stretch along the long axis", () => {
    const g = feltLikeGeometry([0, 1, 0, 1, 0, 1, 0, 1]);
    const { unitSize } = ensurePlanarUVs(g);
    const uv = g.getAttribute("uv");
    const uSpan = uv.getX(1) - uv.getX(0); // across the 5.48 axis
    const vSpan = uv.getY(2) - uv.getY(0); // across the 2.98 axis
    expect(unitSize).toBeCloseTo(5.48, 5);
    expect(uSpan).toBeCloseTo(1, 5);
    // 2.98 / 5.48 — not 1, which is what a per-axis fit would have produced.
    expect(vSpan).toBeCloseTo(2.98 / 5.48, 5);
  });

  it("reuses the existing buffer rather than orphaning it", () => {
    const g = feltLikeGeometry([0, 1, 0, 1, 0, 1, 0, 1]);
    const before = g.getAttribute("uv");
    ensurePlanarUVs(g);
    expect(g.getAttribute("uv")).toBe(before);
  });

  it("creates UVs when there are none at all", () => {
    const g = feltLikeGeometry();
    expect(ensurePlanarUVs(g).status).toBe("created");
    expect(g.getAttribute("uv")).toBeDefined();
  });

  it("leaves genuinely mapped geometry alone unless forced", () => {
    const g = feltLikeGeometry([0, 0, 1, 0, 0, 1, 1, 1]);
    expect(ensurePlanarUVs(g).status).toBe("kept");
    expect(g.getAttribute("uv").getX(1)).toBe(1);
    expect(ensurePlanarUVs(g, { force: true }).status).toBe("replaced");
  });
});

describe("ENVIRONMENT_LAYOUT", () => {
  it("puts the backdrop shell inside the camera's visible floor extent", () => {
    // A shell further away than the floor runs out is simply never on screen.
    expect(ENVIRONMENT_LAYOUT.roomRadius).toBeLessThan(Math.abs(ENVIRONMENT_LAYOUT.visibleFloorZ));
  });

  it("keeps the floor below the felt", () => {
    expect(ENVIRONMENT_LAYOUT.floorY).toBeLessThan(0.01);
  });
});
