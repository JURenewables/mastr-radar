// MapLibre 6 loads its web worker from a separate file, which Next.js does not
// bundle. Copy it into public/ before dev and build (see MapPanel setWorkerUrl).
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8"));
mkdirSync("public/maplibre", { recursive: true });
copyFileSync(
  "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
  `public/maplibre/maplibre-gl-worker-${pkg.version}.mjs`,
);
console.log(`Copied maplibre-gl worker ${pkg.version}`);
