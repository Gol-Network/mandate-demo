import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The parent directory `botanary` has its own pnpm-workspace.yaml. Pinning the
  // Turbopack root to this repository keeps Next from reaching for it.
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;
