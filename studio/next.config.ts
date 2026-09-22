import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "jklsxpziofzzmhvglcaa.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    formats: ["image/webp"],
    minimumCacheTTL: 31536000, // 1 year — generated designs never change
  },
};

export default nextConfig;
