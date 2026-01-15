import type { NextConfig } from 'next';

const allowedOrigins = ['localhost:3000', 'localhost:3010'];
if (process.env.ALLOWED_ORIGIN_HOST) {
  // ALLOWED_ORIGIN_HOST can be comma-separated (e.g., "tasktitan.live,*.tasktitan.live")
  const hosts = process.env.ALLOWED_ORIGIN_HOST.split(',').map((h) => h.trim());
  allowedOrigins.push(...hosts);
}

const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
    serverActions: {
      allowedOrigins,
      bodySizeLimit: '2mb', // Increased from default 1mb to support large AI-generated payloads
    },
  },
  typescript: {
    ignoreBuildErrors: process.env.SKIP_TS_BUILD == 'true',
  },
};

export default nextConfig;
