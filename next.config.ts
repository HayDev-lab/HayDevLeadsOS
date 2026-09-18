import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // v0.19: build must never be green with TypeScript errors
  // (typescript.ignoreBuildErrors removed per spec).
  reactStrictMode: false,
};

export default nextConfig;
