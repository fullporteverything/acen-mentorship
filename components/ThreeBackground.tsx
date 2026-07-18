"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// 3D particle galaxy — CNY red/gold spiral, mouse parallax, WebGL

const PARAMS = {
  count: 8000,
  radius: 5,
  branches: 3,
  spin: 1.2,
  randomness: 0.25,
  randomnessPower: 3.5,
  innerColor: "#DCB44A",  // gold center
  outerColor: "#C41818",  // deep red edges
};

export default function ThreeBackground() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 3.5, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xeadac0, 1);
    mount.appendChild(renderer.domElement);

    // Galaxy geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARAMS.count * 3);
    const colors = new Float32Array(PARAMS.count * 3);

    const innerColor = new THREE.Color(PARAMS.innerColor);
    const outerColor = new THREE.Color(PARAMS.outerColor);

    for (let i = 0; i < PARAMS.count; i++) {
      const i3 = i * 3;
      const r = Math.random() * PARAMS.radius;
      const branchAngle =
        ((i % PARAMS.branches) / PARAMS.branches) * Math.PI * 2;
      const spinAngle = r * PARAMS.spin;

      const rx =
        Math.pow(Math.random(), PARAMS.randomnessPower) *
        (Math.random() < 0.5 ? 1 : -1) *
        PARAMS.randomness *
        r;
      const ry =
        Math.pow(Math.random(), PARAMS.randomnessPower) *
        (Math.random() < 0.5 ? 1 : -1) *
        PARAMS.randomness *
        r;
      const rz =
        Math.pow(Math.random(), PARAMS.randomnessPower) *
        (Math.random() < 0.5 ? 1 : -1) *
        PARAMS.randomness *
        r;

      positions[i3] = Math.cos(branchAngle + spinAngle) * r + rx;
      positions[i3 + 1] = ry;
      positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * r + rz;

      const mixed = innerColor.clone().lerp(outerColor, r / PARAMS.radius);
      colors[i3] = mixed.r;
      colors[i3 + 1] = mixed.g;
      colors[i3 + 2] = mixed.b;
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.028,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });

    const galaxy = new THREE.Points(geometry, material);
    scene.add(galaxy);

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

      // Slow rotation
      galaxy.rotation.y = elapsed * 0.06;

      // Mouse parallax — smooth lerp
      targetX += (mouseX - targetX) * 0.03;
      targetY += (mouseY - targetY) * 0.03;
      camera.position.x = targetX * 1.2;
      camera.position.y = 3.5 + targetY * 0.6;
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
