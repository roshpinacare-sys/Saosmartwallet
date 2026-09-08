import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* NET-AUDIT round 2: type errors were driven to 0 (tsc --noEmit, excluding
   * examples/skills) — the safety mask comes OFF so future type regressions
   * fail the build instead of shipping silently. */
  reactStrictMode: false,
};

export default nextConfig;
