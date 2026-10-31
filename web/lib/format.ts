// Number and date formatting, one place for the whole site.
import type { Technology } from "./types";

const LOCALE = "en-GB";

/** kW → "71.5 GW" or "850 MW". */
export function formatPower(kw: number, { signed = false } = {}): string {
  const sign = signed && kw > 0 ? "+" : "";
  const gw = kw / 1_000_000;
  if (Math.abs(gw) >= 1) {
    return `${sign}${gw.toLocaleString(LOCALE, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GW`;
  }
  const mw = kw / 1_000;
  return `${sign}${mw.toLocaleString(LOCALE, { maximumFractionDigits: 0 })} MW`;
}

export function formatCount(n: number): string {
  return n.toLocaleString(LOCALE);
}

/** "2026-10-30" → "30 Oct 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const TECHNOLOGY_LABELS: Record<Technology, string> = {
  wind_onshore: "Onshore wind",
  wind_offshore: "Offshore wind",
  solar: "Solar",
  storage: "Storage",
  biomass: "Biomass",
  hydro: "Hydro",
};
