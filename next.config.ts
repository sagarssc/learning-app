import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM payload and must be loaded by Node directly, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
