import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  outputFileTracingIncludes: {
    "/api/stats": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/match": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/film-details": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
