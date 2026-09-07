import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;

/* saos-dex bridge — reload marker */

/* relay v2 reload */

/* hive anchor tov */

/* saos-dex terminal bridge: /saos-dex/* → 3010 (basePath). The gateway exposes a
 * single origin; without this rewrite the DEX page HTML loads but every /_next
 * chunk 404s against the host app → blank screen. This rewrite carries the full
 * page+assets+HMR+API surface of the terminal under one origin. */
const nextConfigWithDexBridge: NextConfig = {
  ...nextConfig,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/saos-dex", destination: "http://127.0.0.1:3010/saos-dex" },
        { source: "/saos-dex/:path*", destination: "http://127.0.0.1:3010/saos-dex/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfigWithDexBridge;
