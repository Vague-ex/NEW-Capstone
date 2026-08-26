import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js and only the node_modules
  // actually needed at runtime. Without this the Docker image has to carry the
  // full dependency tree, which is far larger and slower to ship.
  // See node_modules/next/dist/docs/.../05-config/01-next-config-js/output.md
  output: "standalone",
};

export default nextConfig;
