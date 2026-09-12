import type { NextConfig } from "next";

/**
 * SECURITY HARDENING (SEC-HARD round)
 * ===================================
 * Baseline security headers on every response. Design decisions, each
 * documented in docs/security.md:
 *
 * - `poweredByHeader: false` — stop advertising the framework version.
 * - CSP: the app is same-origin only (zero client-side cross-origin
 *   fetches — verified by scan), so `default-src 'self'` holds.
 *   - `script-src 'unsafe-inline' 'unsafe-eval'`: Next.js hydration inline
 *     bootstrap + dev HMR/React-refresh need both; there are NO cookie or
 *     ambient credentials in this app (auth = explicit Bearer/headers), so
 *     inline-script XSS impact is bounded and the strict nonce-middleware
 *     tradeoff is intentionally not taken yet.
 *   - `connect-src ws: wss:`: dev HMR websocket through the gateway; the
 *     app itself opens no outbound WebSockets.
 *   - `frame-ancestors` / `X-Frame-Options` deliberately OMITTED: the
 *     sandbox preview panel may embed the app cross-origin; with no
 *     ambient cookie authority, clickjacking has nothing to steal. See
 *     docs/security.md "Framing decision".
 * - HSTS is a no-op over plain HTTP (browsers ignore it) but future-proofs
 *   the HTTPS deployment at zero cost.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  /* r29 OOM-DEFENSE (proven live): the sandbox OOM-kills next-server when the
   * dev compiler + watcher balloon past the 4GB cgroup ceiling. The upload/
   * tree (user zip extractions, ~25k files) and the local axiom/banker stores
   * must never be watched or compiled. */
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions ?? {}),
      ignored: [
        "**/node_modules/**",
        "**/.next/**",
        "**/upload/**",
        "**/db/axiom/**",
        "**/db/banker/**",
        "**/db/.banker-mirror/**",
        "**/dev.log",
        "**/tool-results/**",
        "**/engineering/**",
      ],
    };
    return config;
  },
  reactStrictMode: false,
  /* NET-AUDIT round 2: type errors were driven to 0 (tsc --noEmit, excluding
   * examples/skills) — the safety mask comes OFF so future type regressions
   * fail the build instead of shipping silently. */
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      // RFC 9116 — security.txt at the standard well-known path (the
      // dot-folder is not routable in App Router, so a rewrite serves it).
      { source: "/.well-known/security.txt", destination: "/api/security-txt" },
    ];
  },
};

export default nextConfig;
