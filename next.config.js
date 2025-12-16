/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    typedRoutes: true
  },
  // Suppress verbose fetch logging (GET /api/... 200 in Xms, cache info, etc.)
  logging: {
    fetches: {
      fullUrl: false
    }
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**'
      }
    ]
  }
};

module.exports = nextConfig;
