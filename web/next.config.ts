import type { NextConfig } from "next";

// The site is fully static: pages are built from the files in public/data,
// which the daily pipeline commits (station 4 reads nothing else).
const nextConfig: NextConfig = {
  // Open data: any website or tool may fetch the data files and the catalogue (WP43).
  async headers() {
    const cors = [{ key: "Access-Control-Allow-Origin", value: "*" }];
    return [
      { source: "/data/:path*", headers: cors },
      { source: "/catalog.json", headers: cors },
      { source: "/llms.txt", headers: cors },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
