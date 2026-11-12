import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/api/jobs/[id]/process": ["./node_modules/ffmpeg-static/**", "./node_modules/ffprobe-static/**"],
  },
  async rewrites() {
    return [{ source: "/mcp", destination: "/api/mcp" }];
  },
};

export default nextConfig;