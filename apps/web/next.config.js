/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Allow access from LAN
  experimental: {
    serverActions: {
      allowedOrigins: ['*'],
    },
  },
  async redirects() {
    return [
      { source: '/dashboard', destination: '/', permanent: true },
      { source: '/dashboard/:path*', destination: '/:path*', permanent: true },
    ];
  },
}

module.exports = nextConfig
