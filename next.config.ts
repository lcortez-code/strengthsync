import type { NextConfig } from "next";

// Read version from package.json at build time
const packageJson = require("./package.json");

const nextConfig: NextConfig = {
  // output: "standalone", // For Docker deployment (uncomment for Docker builds)
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  // Expose version and build time to the client
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
