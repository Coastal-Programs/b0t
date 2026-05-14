import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Force dynamic rendering for all pages to avoid static generation errors
  output: 'standalone',

  // Skip generating 404 and 500 pages during build to prevent Html import errors
  generateBuildId: async () => {
    return 'build-' + Date.now();
  },

  // Skip static error page generation during build
  // This prevents build failures from prerendering errors
  typescript: {
    ignoreBuildErrors: false,
  },

  // Explicitly set Turbopack root to silence multiple lockfiles warning
  turbopack: {
    root: __dirname,
  },

  // Performance optimizations
  experimental: {
    // Tree-shake icon libraries for better bundle size
    optimizePackageImports: ['@radix-ui/react-icons'],
  },

  // Production-only optimizations
  compiler: {
    // Remove console.log in production (keep error/warn for debugging)
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },

  // Exclude packages with native dependencies from webpack bundling
  // This fixes build errors with discord.js and other native modules
  // Note: ioredis and bullmq are NOT in this list to avoid Turbopack conflicts
  serverExternalPackages: [
    'discord.js',
    'zlib-sync',
    'better-sqlite3',
    'sharp',
    'canvas',
    'mongodb',
    'mysql2',
    'pg',
    'snoowrap',
    'bufferutil',
    'utf-8-validate',
    '@node-rs/argon2',
    '@node-rs/bcrypt',
    'pdf-parse',
  ],
};

export default nextConfig;
