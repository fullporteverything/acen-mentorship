"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// Falling sakura petals — cream background, mouse parallax, WebGL

const PETAL_COUNT = 250;

export default function ThreeBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 18);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xeadac0, 1);
    mount.appendChild(renderer.domElement);

    // Petal texture — soft pink ellipse with radial gradient
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 192, 203, 1.0)");
    gradient.addColorStop(1, "rgba(255, 210, 220, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(64, 64, 40, 60, 0, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);

    // Petal instanced mesh
    const geometry = new THREE.PlaneGeometry(0.4, 0.65);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, PETAL_COUNT);
    scene.add(mesh);

    // Per-petal state
    type Petal = {
      x: number;
      y: number;
      z: number;
      rx: number;
      ry: number;
      rz: number;
      vy: number;
      rvx: number;
      rvy: number;
      rvz: number;
      swayFreq: number;
      swayOffset: number;
    };

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    const petals: Petal[] = [];
    for (let i = 0; i < PETAL_COUNT; i++) {
      petals.push({
        x: rand(-18, 18),
        y: rand(-12, 12),
        z: rand(-3, 3),
        rx: rand(0, Math.PI * 2),
        ry: rand(0, Math.PI * 2),
        rz: rand(0, Math.PI * 2),
        vy: rand(-0.035, -0.015),
        rvx: rand(-0.01, 0.01),
        rvy: rand(-0.01, 0.01),
        rvz: rand(-0.01, 0.01),
        swayFreq: rand(0.5, 1.5),
        swayOffset: rand(0, Math.PI * 2),
      });
    }

    const dummy = new THREE.Object3D();

    // Mouse parallax
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      mouseY = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouseMove);

    // Animation
    const clock = new THREE.Clock();
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      for (let i = 0; i < PETAL_COUNT; i++) {
        const p = petals[i];

        // Fall + gentle horizontal sway
        p.y += p.vy;
        p.x += Math.sin(elapsed * p.swayFreq + p.swayOffset) * 0.006;

        // Slow 3D rotation on all axes
        p.rx += p.rvx;
        p.ry += p.rvy;
        p.rz += p.rvz;

        // Recycle petals that fall off the bottom
        if (p.y < -13) {
          p.y = 13;
          p.x = rand(-18, 18);
        }

        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx, p.ry, p.rz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;

      // Mouse parallax — smooth lerp, subtle tilt
      targetX += (mouseX - targetX) * 0.03;
      targetY += (mouseY - targetY) * 0.03;
      camera.position.x = targetX * 0.5;
      camera.position.y = targetY * 0.5;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    animate();

    // Resize
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
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
    />
  );
}
