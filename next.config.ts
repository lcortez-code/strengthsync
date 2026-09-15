import type { NextConfig } from "next";

// Read version from package.json at build time
const packageJson = require("./package.json");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/strengths/upload": [".document-worker/parser.cjs", "node_modules/pdf-parse/**/*", "node_modules/pdfjs-dist/**/*", "node_modules/@napi-rs/canvas*/**/*"],
    "/api/admin/members/bulk": [".document-worker/parser.cjs", "node_modules/pdf-parse/**/*", "node_modules/pdfjs-dist/**/*", "node_modules/@napi-rs/canvas*/**/*"],
    "/api/admin/members/excel-import": [".document-worker/parser.cjs", "node_modules/pdf-parse/**/*", "node_modules/pdfjs-dist/**/*", "node_modules/@napi-rs/canvas*/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }, ...["/auth/:path*", "/api/auth/:path*", "/api/integrations/teams-link"].map((source) => ({ source, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "no-store" },
    ] }))];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: process.env.AWS_S3_BUCKET && process.env.AWS_REGION ? [
      {
        protocol: "https",
        hostname: `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`,
        pathname: "/avatars/**",
      },
    ] : [],
  },
  // Expose version and build time to the client
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
