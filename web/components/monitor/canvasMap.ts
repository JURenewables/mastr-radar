"use client";

// Shared helpers for the monitor's canvas maps (Germany, districts, plant dots).
import { geoMercator, geoPath, type GeoProjection } from "d3-geo";

export interface DistrictShape {
  key: string;
  path: Path2D;
  km2: number;
}

export function setupCanvas(canvas: HTMLCanvasElement, maxHeight = 720) {
  const width = canvas.parentElement?.clientWidth ?? 600;
  const height = Math.round(Math.min(width * 1.18, maxHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

export function projectGermany(
  geo: GeoJSON.FeatureCollection,
  width: number,
  height: number,
  top = 64,
): { projection: GeoProjection; districts: DistrictShape[] } {
  const projection = geoMercator().fitExtent(
    [
      [12, top],
      [width - 12, height - 12],
    ],
    geo,
  );
  const gp = geoPath(projection);
  const districts = geo.features.map((f) => ({
    key: String(f.properties?.key),
    path: new Path2D(gp(f) ?? ""),
    km2: Number(f.properties?.area_km2) || 1,
  }));
  return { projection, districts };
}

/** Darker tone of a hex colour, for dots on a same-colour background. */
export function darken(hex: string, factor = 0.68): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map((x) => Math.round(parseInt(x, 16) * factor));
  return `rgb(${r},${g},${b})`;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
