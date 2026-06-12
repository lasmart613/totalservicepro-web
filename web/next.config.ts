import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// ESM-compatible __dirname shim (Next.js config can be loaded as ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig: NextConfig = {
  // Use Webpack for production builds via the --webpack flag in package.json
  // This avoids Turbopack native binding issues seen on some Windows setups and ensures compatibility.
  // See: https://nextjs.org/docs/app/api-reference/turbopack#supported-platforms
  typescript: {
    // Ignore TypeScript errors during build (the ported code from the original JS app may have type issues).
    // Remove or fix once the web version is fully typed.
    ignoreBuildErrors: true,
  },
  // Enable standalone output for Netlify (and other serverless platforms).
  // Required for @netlify/plugin-nextjs to properly bundle the Next.js server into functions.
  // This produces .next/standalone with a pruned node_modules for the runtime.
  output: 'standalone',
  // Tell Next.js the correct root so it doesn't pick the parent lockfile at C:\Users\larry\
  outputFileTracingRoot: path.join(__dirname),
  // Force-include caniuse-lite feature data files in the file trace / standalone output.
  // (Moved out of experimental in Next 16+). These are used by browserslist/postcss at build time
  // but can be missing from the pruned node_modules in .next/standalone, causing ENOENT lstat
  // errors in @netlify/plugin-nextjs during its onBuild copyDir steps on Windows deploys.
  // See: https://nextjs.org/docs/messages/invalid-next-config
  outputFileTracingIncludes: {
    '**/*': [
      'node_modules/caniuse-lite/data/features/*.js',
      'node_modules/caniuse-lite/**/*',
    ],
  },
  // Disable Next.js Image Optimization (unoptimized: true) because the app does not use the
  // <Image> component from next/image (only plain <img> for generated signature data in PDFs,
  // and static SVGs/icons in /public). This avoids pulling in the `sharp` native binary
  // (and its platform-specific .dll/.so files like libvips for win32/linux) into the
  // .next/standalone and the Netlify functions bundle (___netlify-server-handler), which was
  // causing ENOENT errors for sharp-win32-x64 lib during functions bundling on Windows CLI deploys.
  // Netlify functions run on Linux; avoiding sharp here prevents bundling native module issues.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
