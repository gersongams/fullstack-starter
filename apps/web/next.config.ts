import path from "node:path";

import type { NextConfig } from "next";

// Read when the config is loaded, which for `next build` means build time.
const apiInternalUrl = process.env.API_INTERNAL_URL?.replace(/\/$/, "");
if (!apiInternalUrl || !URL.canParse(apiInternalUrl)) {
  throw new Error(
    "API_INTERNAL_URL must be set to the Go API origin, e.g. http://localhost:8787 (see apps/web/.env.example).",
  );
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  typedRoutes: true,
  poweredByHeader: false,
  output: "standalone",
  // pnpm keeps dependencies at the monorepo root, so trace from there.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),

  async rewrites() {
    // The browser only talks to this origin; /api/auth/* stays in Next.js.
    return [{ source: "/api/v1/:path*", destination: `${apiInternalUrl}/api/v1/:path*` }];
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
