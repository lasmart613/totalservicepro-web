import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  outputFileTracingIncludes: {
    "**/*": [
      "node_modules/caniuse-lite/data/features/*.js",
      "node_modules/caniuse-lite/**/*",
    ],
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;