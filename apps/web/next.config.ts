import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The scoring engines run in the browser too, so a scorer keeps scoring offline (FR-SCR-12).
  transpilePackages: ["@force-pulse/scoring", "@force-pulse/shared"],
};

export default config;
