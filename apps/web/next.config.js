/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@ojaven/db",
    "@ojaven/server",
    "@ojaven/shared",
    "@ojaven/ui",
    "@ojaven/emails",
  ],
};

module.exports = nextConfig;
