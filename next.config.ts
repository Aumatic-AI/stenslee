import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev server's HMR websocket accept connections from the ngrok
  // tunnel origin -- without this, Next refuses those requests and the
  // console fills with "WebSocket connection ... failed" on every retry.
  // Update this if the ngrok subdomain changes (a new tunnel = a new one).
  allowedDevOrigins: ["privatize-cornbread-procreate.ngrok-free.dev"],
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
