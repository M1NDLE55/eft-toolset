/** @type {import('next').NextConfig} */
const nextConfig = {
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
