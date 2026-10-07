import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      // A published snapshot's own `about.url` is `<site>/snapshots/<id>`
      // (the form the first three snapshots use), built from its minted id
      // (ADR 0014). This gateway serves a snapshot at `/repository/<id>`.
      // Temporary, not permanent: a browser caches a 308 for good, and the
      // route a snapshot lives at is this app's to move.
      { source: "/snapshots/:id", destination: "/repository/:id", permanent: false },
    ];
  },
};

export default nextConfig;
