// Design tokens used from code (charts, maps). CSS tokens live in app/globals.css;
// both read the same CSS variables, so light and dark mode stay in sync.
import type { Technology } from "./types";

export const TECHNOLOGIES: Technology[] = [
  "solar",
  "wind_onshore",
  "wind_offshore",
  "storage",
  "biomass",
  "hydro",
];

export const TECH_CSS_VAR: Record<Technology, string> = {
  wind_onshore: "--tech-wind-onshore",
  wind_offshore: "--tech-wind-offshore",
  solar: "--tech-solar",
  storage: "--tech-storage",
  biomass: "--tech-biomass",
  hydro: "--tech-hydro",
};

/** Read a CSS variable at runtime (client only), e.g. for MapLibre and Plot. */
export function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function techColor(t: Technology): string {
  return cssVar(TECH_CSS_VAR[t]);
}

export const STATUS_LABELS = {
  operating: "In operation",
  planned: "Planned",
  temporarily_shut_down: "Temporarily shut down",
  permanently_shut_down: "Permanently shut down",
} as const;

export type Status = keyof typeof STATUS_LABELS;

export const SIZE_CLASSES = ["<10 kW", "10–100 kW", "100 kW–1 MW", "1–10 MW", "≥10 MW"] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** Basemaps: quiet and light, so the data stands out (OpenFreeMap, no key needed). */
export const BASEMAP = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
