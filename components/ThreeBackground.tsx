"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

// Individual floating geometry — each is a small 3D shape slowly drifting and rotating
function FloatingShape({
  position,
  rotation,
  scale,
  speed,
  geometry,
  opacity,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  speed: number;
  geometry: "octa" | "icosa" | "tetra" | "box";
  opacity: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const driftRef = useRef({
    x: (Math.random() - 0.5) * 0.002 * speed,
    y: (Math.random() - 0.5) * 0.002 * speed,
    z: 0,
  });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    meshRef.current.rotation.x += 0.003 * speed;
    meshRef.current.rotation.y += 0.005 * speed;
    meshRef.current.rotation.z += 0.002 * speed;

    // Gentle drift with slight sine wave
    meshRef.current.position.x += driftRef.current.x;
    meshRef.current.position.y += driftRef.current.y + Math.sin(t * 0.3 * speed) * 0.0005;

    // Wrap around when out of bounds
    if (meshRef.current.position.x > 14) driftRef.current.x *= -1;
    if (meshRef.current.position.x < -14) driftRef.current.x *= -1;
    if (meshRef.current.position.y > 8) driftRef.current.y *= -1;
    if (meshRef.current.position.y < -8) driftRef.current.y *= -1;

    // Pulsing scale
    const pulse = 1 + Math.sin(t * 0.8 * speed + position[0]) * 0.04;
    meshRef.current.scale.setScalar(scale * pulse);
  });

  const geo = useMemo(() => {
    switch (geometry) {
      case "octa": return new THREE.OctahedronGeometry(1, 0);
      case "icosa": return new THREE.IcosahedronGeometry(1, 0);
      case "tetra": return new THREE.TetrahedronGeometry(1, 0);
      case "box": return new THREE.BoxGeometry(1, 1, 1);
      default: return new THREE.OctahedronGeometry(1, 0);
    }
  }, [geometry]);

  return (
    <mesh
      ref={meshRef}
      position={position}
      rotation={rotation}
      scale={scale}
      geometry={geo}
    >
      <meshStandardMaterial
        color={new THREE.Color("#c9a84c")}
        emissive={new THREE.Color("#7a5c1e")}
        emissiveIntensity={0.3}
        transparent
        opacity={opacity}
        wireframe={Math.random() > 0.5}
        roughness={0.4}
        metalness={0.8}
      />
    </mesh>
  );
}

// Particle field of tiny gold dots
function ParticleField() {
  const count = 200;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 15;
    }
    return pos;
  }, []);

  const pointsRef = useRef<THREE.Points>(null!);

  useFrame((state) => {
    pointsRef.current.rotation.y = state.clock.elapsedTime * 0.01;
    pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.005) * 0.05;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#c9a84c"
        size={0.04}
        transparent
        opacity={0.4}
        sizeAttenuation
      />
    </points>
  );
}

// The main scene
function Scene() {
  const shapes = useMemo(() => {
    const types: Array<"octa" | "icosa" | "tetra" | "box"> = ["octa", "icosa", "tetra", "box"];
    return Array.from({ length: 28 }, (_, i) => ({
      id: i,
      position: [
        (Math.random() - 0.5) * 26,
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 10 - 2,
      ] as [number, number, number],
      rotation: [
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      ] as [number, number, number],
      scale: 0.08 + Math.random() * 0.32,
      speed: 0.4 + Math.random() * 1.2,
      geometry: types[Math.floor(Math.random() * types.length)],
      opacity: 0.12 + Math.random() * 0.35,
    }));
  }, []);

  return (
    <>
      {/* Ambient and directional light */}
      <ambientLight intensity={0.15} color="#2a1a00" />
      <directionalLight position={[5, 5, 5]} intensity={0.8} color="#c9a84c" />
      <directionalLight position={[-5, -3, -5]} intensity={0.3} color="#4a2a00" />
      <pointLight position={[0, 0, 3]} intensity={0.6} color="#e0bf6a" distance={15} />

      {/* Floating 3D shapes */}
      {shapes.map((s) => (
        <FloatingShape key={s.id} {...s} />
      ))}

      {/* Micro particle field */}
      <ParticleField />
    </>
  );
}

export default function ThreeBackground() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        background: "#0a0a0a",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        style={{ background: "transparent" }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "default",
        }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
