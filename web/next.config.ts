import type { NextConfig } from "next";

// The site is fully static: pages are built from the files in public/data,
// which the daily pipeline commits (station 4 reads nothing else).
const nextConfig: NextConfig = {
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
