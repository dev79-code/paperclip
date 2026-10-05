/** @type {import('next').NextConfig} */
// When BACKEND_URL is set (e.g. on Vercel), every /api/* request is proxied to the VPS that runs
// the agent and stores the data. Leave it unset on the VPS itself.
const backend = process.env.BACKEND_URL?.replace(/\/$/, "");

export default {
  reactStrictMode: true,
  async rewrites() {
    return backend ? { beforeFiles: [{ source: "/api/:path*", destination: `${backend}/api/:path*` }] } : [];
  },
};
