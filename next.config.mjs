/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.tarkov.dev",
      },
    ],
  },
};

export default nextConfig;
