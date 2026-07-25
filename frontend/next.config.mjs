/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config) => {
    // Optional peers of the wallet SDKs that this app never loads: Solana
    // support in @openfort/react, Porto in @wagmi/connectors, and pino's
    // pretty printer. Stub them so webpack stops trying to resolve them.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@solana/kit': false,
      '@solana/kora': false,
      '@solana-program/token': false,
      '@solana-program/system': false,
      'porto/internal': false,
      'pino-pretty': false,
      // Lazily imported by @wagmi/core's tempo connector, which we never use
      accounts: false,
    }
    return config
  },
}

export default nextConfig
