import type { NextConfig } from "next";

// Static export for GitHub Pages. The Actions workflow sets
// NEXT_PUBLIC_BASE_PATH=/aroundnet-web; local dev leaves it empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
  trailingSlash: true,
  // Deep links like /tournaments/123 are client-rendered; the SPA fallback
  // (404.html) is generated in the deploy workflow.
};

export default nextConfig;
