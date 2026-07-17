import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow Three.js and related packages to be transpiled correctly
  transpilePackages: ["three"],
};

export default nextConfig;
