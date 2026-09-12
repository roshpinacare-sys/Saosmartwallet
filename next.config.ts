import type { NextConfig } from "next";

/* saos-dex terminal bridge: /saos-dex/* → 3010 (basePath). The gateway exposes a
 * single origin; without this rewrite the DEX page HTML loads but every /_next
 * chunk 404s against the host app → blank screen. This rewrite carries the full
 * page+assets+HMR+API surface of the terminal under one origin.
 *
 * Zero-Tolerance Visual Overhaul: the institutional terminal now lives at `/`
 * itself (assets served by THIS app — always 200); the /saos-dex bridge remains
 * for deep links and the daemon API surface. */
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  /* Task 71-flow: ספריית-steem (CJS ישן) חייבת-node-raw ב-API-routes — בלי-bundling */
  serverExternalPackages: ["steem"],
  reactStrictMode: false,
  /* Zero-Tolerance: dev-assets חייבים לעבור דרך-השער בלי-חסימת-מוצא (HMR + chunks) */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        // אפס-מטמון ל-HTML — הדפדפן תמיד מקבל גרסה-חיה
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
      },
    ];
  },
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

export default nextConfig;
