import path from 'path';
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  compress: true,
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'three',
      'recharts',
      '@tanstack/react-query',
      '@radix-ui/react-dialog',
      '@radix-ui/react-popover',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
      'motion',
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/setting',
        destination: '/admin',
        permanent: false,
      },
      {
        source: '/setting/:path*',
        destination: '/admin',
        permanent: false,
      },
      {
        source: '/settings',
        destination: '/admin',
        permanent: false,
      },
      {
        source: '/settings/:path*',
        destination: '/admin',
        permanent: false,
      },
    ];
  },
  // ponytail: standalone output is ONLY enabled for the Docker packaging path
  // (scripts/package-production.sh, which runs `node .next/standalone/server.js`
  // inside its entrypoint). For the normal runtime — Colab, local start.sh,
  // supervisor restart, watchdog recovery — the standard `npm start` /
  // `next start` production server is used instead. Next.js 16 refuses to run
  // `next start` when output is 'standalone', so leaving it on unconditionally
  // broke the standard production workflow. Toggle via FORMASH3D_STANDALONE=1 or AI_STUDIO_STANDALONE=1.
  ...((process.env.FORMASH3D_STANDALONE === '1' || process.env.AI_STUDIO_STANDALONE === '1') ? { output: 'standalone' } : {}),
  transpilePackages: ['three'],

  // Prevents turbopack from resolving workspace root to a parent directory
  // that contains a different lockfile, which causes dev server instability.
  turbopack: { root: path.resolve(__dirname) },

  // Allow dev server access from non-localhost hosts (e.g. Docker, tunnel, LAN)
  // Only applied in development — production builds don't use the dev server.
  ...(process.env.NODE_ENV === "development"
    ? {
        allowedDevOrigins: [
          'localhost',
          'localhost:3000',
          '127.0.0.1',
          '127.0.0.1:3000',
          '0.0.0.0',
          '0.0.0.0:3000',
          '*',
          '*.trycloudflare.com',
          '*.run.app',
          '*.asia-east1.run.app',
          '*.cloudspaces.litng.ai',
          '3000-*.cloudspaces.litng.ai',
        ],
      }
    : {}),
};

export default nextConfig;
