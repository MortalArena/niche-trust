import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.polymarket.com' },
      { protocol: 'https', hostname: 'polymarket-upload.s3.us-east-2.amazonaws.com' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
