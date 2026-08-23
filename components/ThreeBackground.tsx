"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * Falling-objects background (WebGL, solid black, mouse parallax).
 *
 * It renders one InstancedMesh per "kind" of falling object, so the same engine
 * powers the sakura petals today AND the casino chips + cards mix later. Each
 * kind supplies its own texture, plane size, count, and tumble feel.
 *
 *   variant="petals" (default) — the original sakura petals. Unchanged.
 *   variant="deck"             — a mix of gold chips + playing cards.
 *
 * ── Dropping in the Blender art ────────────────────────────────────────────
 * The chip/card textures below are PROCEDURAL placeholders. When the Blender
 * renders are ready, export each as a transparent PNG into /public/brand/ and
 * set `textureUrl` on that kind (e.g. textureUrl: "/brand/chip.png"). If
 * `textureUrl` is present it's loaded instead of drawing the canvas fallback —
 * that's the only change needed to go from placeholder → real 3D art.
 */

type Variant = "petals" | "deck";

interface FallingKind {
  /** Optional Blender sprite. When set, this PNG is used instead of drawKind. */
  textureUrl?: string;
  /** Canvas fallback used until a textureUrl is provided. */
  drawKind?: (ctx: CanvasRenderingContext2D, size: number) => void;
  /** Plane size in world units [width, height]. */
  size: [number, number];
  count: number;
  /** Downward speed range. */
  vy: [number, number];
  /** Per-axis rotation-velocity range (bigger = more tumble). */
  spin: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/* ── Procedural placeholder textures ─────────────────────────────────────── */

function drawPetal(ctx: CanvasRenderingContext2D, s: number) {
  // Champagne-gold petals for the black + gold noir theme (was rose).
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(247, 232, 172, 0.95)");
  g.addColorStop(1, "rgba(231, 192, 113, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(s / 2, s / 2, s * 0.31, s * 0.47, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawChip(ctx: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  const r = s * 0.44;
  // body — gold radial
  const g = ctx.createRadialGradient(c * 0.85, c * 0.8, 2, c, c, r);
  g.addColorStop(0, "#f7e8ac");
  g.addColorStop(0.55, "#e3c071");
  g.addColorStop(1, "#8a6c24");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // edge notches
  ctx.strokeStyle = "rgba(20,12,4,0.55)";
  ctx.lineWidth = s * 0.05;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    ctx.lineTo(c + Math.cos(a) * (r - s * 0.07), c + Math.sin(a) * (r - s * 0.07));
    ctx.stroke();
  }
  // inner ring + center pip
  ctx.strokeStyle = "rgba(247,232,172,0.9)";
  ctx.lineWidth = s * 0.018;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#3a1220";
  ctx.font = `bold ${s * 0.4}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("7", c, c + s * 0.02);
}

function drawCard(ctx: CanvasRenderingContext2D, s: number) {
  // a tall playing card centered in the square canvas
  const w = s * 0.5;
  const h = s * 0.74;
  const x = (s - w) / 2;
  const y = (s - h) / 2;
  const rad = s * 0.06;
  const rr = () => {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  rr();
  ctx.fillStyle = "#0e0a10";
  ctx.fill();
  ctx.strokeStyle = "#e3c071";
  ctx.lineWidth = s * 0.02;
  ctx.stroke();
  // center suit + rank
  ctx.fillStyle = "#e3c071";
  ctx.font = `bold ${s * 0.26}px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♠", s / 2, s / 2 + s * 0.02);
  ctx.fillStyle = "#e3c071";
  ctx.font = `bold ${s * 0.13}px Georgia, serif`;
  ctx.fillText("7", x + w * 0.28, y + h * 0.2);
}

/* ── Variant configs ─────────────────────────────────────────────────────── */

const VARIANTS: Record<Variant, FallingKind[]> = {
  petals: [
    { drawKind: drawPetal, size: [0.4, 0.65], count: 250, vy: [-0.035, -0.015], spin: 0.01 },
  ],
  deck: [
    // Real Blender render (toon look). chip-photoreal.png is the alternate.
    { textureUrl: "/brand/chip.png", drawKind: drawChip, size: [0.7, 0.7], count: 70, vy: [-0.03, -0.014], spin: 0.02 },
    // Real Blender render (toon 7♠, matches chip.png).
    { textureUrl: "/brand/card.png", drawKind: drawCard, size: [0.62, 0.9], count: 70, vy: [-0.026, -0.012], spin: 0.018 },
  ],
};

interface Instance {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  vy: number; rvx: number; rvy: number; rvz: number;
  swayFreq: number; swayOffset: number;
}

export default function ThreeBackground({ variant = "petals" }: { variant?: Variant } = {}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 18);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 1);
    mount.appendChild(renderer.domElement);

    const loader = new THREE.TextureLoader();
    const disposables: { dispose: () => void }[] = [];

    // Build one instanced mesh per kind of falling object.
    const kinds = VARIANTS[variant].map((kind) => {
      let texture: THREE.Texture;
      if (kind.textureUrl) {
        texture = loader.load(kind.textureUrl);
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext("2d")!;
        kind.drawKind?.(ctx, 128);
        texture = new THREE.CanvasTexture(canvas);
      }
      const geometry = new THREE.PlaneGeometry(kind.size[0], kind.size[1]);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, kind.count);
      scene.add(mesh);
      disposables.push(geometry, material, texture);

      const instances: Instance[] = [];
      for (let i = 0; i < kind.count; i++) {
        instances.push({
          x: rand(-18, 18), y: rand(-12, 12), z: rand(-3, 3),
          rx: rand(0, Math.PI * 2), ry: rand(0, Math.PI * 2), rz: rand(0, Math.PI * 2),
          vy: rand(kind.vy[0], kind.vy[1]),
          rvx: rand(-kind.spin, kind.spin),
          rvy: rand(-kind.spin, kind.spin),
          rvz: rand(-kind.spin, kind.spin),
          swayFreq: rand(0.5, 1.5), swayOffset: rand(0, Math.PI * 2),
        });
      }
      return { mesh, instances };
    });

    const dummy = new THREE.Object3D();

    let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;
    const onMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouseMove);

    const clock = new THREE.Clock();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      for (const { mesh, instances } of kinds) {
        for (let i = 0; i < instances.length; i++) {
          const p = instances[i];
          p.y += p.vy;
          p.x += Math.sin(elapsed * p.swayFreq + p.swayOffset) * 0.006;
          p.rx += p.rvx; p.ry += p.rvy; p.rz += p.rvz;
          if (p.y < -13) { p.y = 13; p.x = rand(-18, 18); }
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(p.rx, p.ry, p.rz);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }

      targetX += (mouseX - targetX) * 0.03;
      targetY += (mouseY - targetY) * 0.03;
      camera.position.x = targetX * 0.5;
      camera.position.y = targetY * 0.5;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      mount.removeChild(renderer.domElement);
      for (const d of disposables) d.dispose();
      renderer.dispose();
    };
  }, [variant]);

  return <div ref={mountRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} />;
}
