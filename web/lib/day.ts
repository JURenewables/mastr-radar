"use client";

// Hub day files (contract v1.4 draft): SMARD 15-minute series and DWD weather.
import { useEffect, useState } from "react";

export const REGIONS = ["DE", "50Hertz", "Amprion", "TenneT", "TransnetBW"] as const;
export type Region = (typeof REGIONS)[number];

export const GEN_TECHS = [
  "solar",
  "wind_onshore",
  "wind_offshore",
  "biomass",
  "hydro",
  "other_renewable",
  "pumped_storage",
  "gas",
  "hard_coal",
  "lignite",
  "other_conventional",
] as const;
export type GenTech = (typeof GEN_TECHS)[number];
export const RENEWABLE: GenTech[] = ["solar", "wind_onshore", "wind_offshore", "biomass", "hydro", "other_renewable"];

export const GEN_LABELS: Record<GenTech, string> = {
  solar: "Solar",
  wind_onshore: "Onshore wind",
  wind_offshore: "Offshore wind",
  biomass: "Biomass",
  hydro: "Hydro",
  other_renewable: "Other renewables",
  pumped_storage: "Pumped storage",
  gas: "Gas",
  hard_coal: "Hard coal",
  lignite: "Lignite",
  other_conventional: "Other conventional",
};

export interface DayFile {
  date: string;
  slots: number;
  start_utc: string;
  regions: Region[];
  generation_mw: Record<Region, Record<GenTech, (number | null)[]>>;
  demand_mw: Record<Region, (number | null)[]>;
  residual_load_mw: Record<Region, (number | null)[]>;
  weather: {
    hours: number;
    solar_stations: string[];
    radiation_wm2: (number | null)[][];
    wind_stations: string[];
    wind_dms: (number | null)[][];
  } | null;
  sources: string[];
}
export interface DayIndex {
  first: string;
  last: string;
  dates: string[];
}
export interface Stations {
  solar: [string, number, number, string][];
  wind: [string, number, number, string][];
}

/**
 * Approximate grid areas by state (the real borders do not follow states:
 * e.g. parts of Hesse and Bavaria belong to Amprion). Used only for the map.
 */
export const STATE_TO_TSO: Record<string, Exclude<Region, "DE">> = {
  "01": "TenneT",
  "02": "50Hertz",
  "03": "TenneT",
  "04": "TenneT",
  "05": "Amprion",
  "06": "TenneT",
  "07": "Amprion",
  "08": "TransnetBW",
  "09": "TenneT",
  "10": "Amprion",
  "11": "50Hertz",
  "12": "50Hertz",
  "13": "50Hertz",
  "14": "50Hertz",
  "15": "50Hertz",
  "16": "50Hertz",
};

const cache = new Map<string, Promise<unknown>>();
function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) cache.set(path, fetch(path).then((r) => r.json()));
  return cache.get(path) as Promise<T>;
}

export function useDayIndex(version: string) {
  const [state, setState] = useState<{ index: DayIndex; stations: Stations } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      getJson<DayIndex>(`/data/days/index.json?v=${version}`),
      getJson<Stations>(`/data/days/stations.json?v=${version}`),
    ]).then(([index, stations]) => live && setState({ index, stations }));
    return () => {
      live = false;
    };
  }, [version]);
  return state;
}

export function useDay(date: string | null) {
  const [day, setDay] = useState<DayFile | null>(null);
  useEffect(() => {
    if (!date) return;
    let live = true;
    getJson<DayFile>(`/data/days/${date}.json`).then((d) => live && setDay(d));
    return () => {
      live = false;
    };
  }, [date]);
  return day && day.date === date ? day : null;
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
/** Local clock time of a quarter hour. */
export function slotTime(day: DayFile, slot: number): string {
  return timeFmt.format(new Date(Date.parse(day.start_utc) + slot * 15 * 60 * 1000));
}

/** Inverse-distance weights of the k nearest stations for a point. */
export function nearest(
  lat: number,
  lon: number,
  stations: { lat: number; lon: number; row: number }[],
  k = 4,
): { row: number; w: number }[] {
  const kx = Math.cos((lat * Math.PI) / 180);
  const d = stations
    .map((s) => ({ row: s.row, d2: (s.lat - lat) ** 2 + ((s.lon - lon) * kx) ** 2 }))
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, k);
  const w = d.map((x) => 1 / Math.max(x.d2, 1e-4));
  const sum = w.reduce((a, b) => a + b, 0);
  return d.map((x, i) => ({ row: x.row, w: w[i] / sum }));
}

/** Rough share of rated power from 10 m wind speed (shape only; scaled to measured output later). */
export function windFactor(v10: number): number {
  const v = v10 * 1.65; // to ~120 m hub height (power law, exponent ≈ 0.2)
  if (v < 3 || v > 25) return 0;
  if (v >= 12) return 1;
  return (v ** 3 - 27) / (1728 - 27);
}
