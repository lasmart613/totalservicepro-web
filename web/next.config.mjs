import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Netlify Next Runtime packages the app — do not use standalone
  outputFileTracingRoot: path.join(__dirname),
  images: {
    unoptimized: true,
  },
  async redirects() {
    // Belt-and-suspenders with middleware: old Android asset URLs
    return [
      { source: '/accepted_bids.html', destination: '/accepted-bids', permanent: false },
      { source: '/service_requests.html', destination: '/accepted-bids', permanent: false },
      { source: '/notifications.html', destination: '/notifications', permanent: false },
      { source: '/service_schedule.html', destination: '/service-schedule', permanent: false },
      { source: '/marketplace.html', destination: '/marketplace', permanent: false },
      { source: '/index.html', destination: '/', permanent: false },
      { source: '/marketplace/service-requests', destination: '/service-requests', permanent: false },
      { source: '/marketplace/service-requests/:path*', destination: '/marketplace/requests/:path*', permanent: false },
    ];
  },
};

export default nextConfig;