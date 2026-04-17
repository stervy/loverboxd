import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // TMDB poster/backdrop CDN. Only /t/p/ is used by the API — restrict the
    // path prefix so Next.js won't optimize arbitrary tmdb.org paths.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

export default nextConfig;
