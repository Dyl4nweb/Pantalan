/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ["three"],
  webpack: (config, { dev }) => {
    if (dev) {
      // Disabling persistent packfile cache in dev eliminates stale chunk MODULE_NOT_FOUND (819.js) on Windows
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;

