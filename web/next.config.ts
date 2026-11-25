import type { NextConfig } from "next";

// The site is static: pages are built from the files in public/data, which the
// daily pipeline commits (station 4 reads nothing else). The one server route,
// /mcp (contract v1.10), queries those same files with DuckDB.
const DUCKDB_NATIVE = ["./node_modules/@duckdb/node-bindings-linux-x64/**/*", "./node_modules/detect-libc/**/*"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  // The published files (without the large day files of the hub) ship with the function.
  // duckdb.node links libduckdb.so at load time, which file tracing cannot see.
  outputFileTracingIncludes: {
    "/mcp": ["./public/data/*", "./public/data/{auctions,boundaries,grid,monitor,outlook}/**/*", "./mcp-docs/**/*", ...DUCKDB_NATIVE],
    "/mcp/health": ["./public/data/*", "./public/data/{auctions,boundaries,grid,monitor,outlook}/**/*", ...DUCKDB_NATIVE],
  },
  // Open data: any website or tool may fetch the data files and the catalogue (WP43).
  async headers() {
    const cors = [{ key: "Access-Control-Allow-Origin", value: "*" }];
    return [
      { source: "/data/:path*", headers: cors },
      { source: "/catalog.json", headers: cors },
      { source: "/llms.txt", headers: cors },
      { source: "/llms-full.txt", headers: cors },
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
