"use client";

// Monitor files (contract v1.3, station 3). Fetched once per page.
import { useEffect, useState } from "react";

import type { Technology } from "./types";

export interface Series {
  added: number[];
  retired: number[];
  installed: number[];
  units_added: number[];
}
export interface Buildout {
  years: number[];
  techs: Technology[];
  national: Record<Technology, Series>;
  district: Record<Technology, Record<string, number[]>>;
}
export interface Points {
  first_year: number;
  techs: Technology[];
  operating: number[]; // 5 per plant: lon*100, lat*100, year offset, tech index, MW
  planned_onshore: number[]; // 3 per turbine: lon*100, lat*100, MW
}
export interface StateRow {
  key: string;
  name: string;
  area_km2: number | null;
  operating_mw: Record<Technology, number>;
  planned_mw: Record<Technology, number>;
}
export interface Stats {
  as_of: string;
  installed_mw: Record<Technology, number>;
  targets_2030_mw: Partial<Record<Technology, number>>;
  ytd_cumulative_mw: Record<Technology, Record<string, number[]>>;
  solar_by_type: {
    years: number[];
    mw: Record<"ground_mounted" | "rooftop" | "balcony" | "other", number[]>;
    units: Record<"ground_mounted" | "rooftop" | "balcony" | "other", number[]>;
  };
  onshore_turbines: {
    years: number[];
    count: number[];
    avg_mw: number[];
    avg_hub_height_m: (number | null)[];
    avg_rotor_diameter_m: (number | null)[];
  };
  battery_storage: {
    years: number[];
    buckets: Record<"home" | "commercial" | "large", { mw: number[]; mwh: number[]; units: number[] }>;
  };
  states: StateRow[];
  top_districts: Record<string, { key: string; name: string; mw: number; mw_per_km2: number }[]>;
  repowering: {
    age_years: number;
    commissioned_until: number;
    units: number;
    mw: number;
    avg_mw_old: number | null;
    avg_mw_new: number | null;
    by_state: Record<string, { units: number; mw: number }>;
  };
  planned_mw: Record<Technology, number>;
}
export interface MonitorData {
  buildout: Buildout;
  stats: Stats;
  points: Points;
  districts: GeoJSON.FeatureCollection;
}

let cache: Promise<MonitorData> | null = null;

function load(version: string): Promise<MonitorData> {
  const get = (path: string) => fetch(`/data/${path}?v=${version}`).then((r) => r.json());
  return Promise.all([
    get("monitor/buildout.json"),
    get("monitor/stats.json"),
    get("monitor/points.json"),
    get("boundaries/districts.geojson"),
  ]).then(([buildout, stats, points, districts]) => ({ buildout, stats, points, districts }));
}

/** All monitor data, or null while loading. `version` is the manifest's as_of. */
export function useMonitorData(version: string): MonitorData | null {
  const [data, setData] = useState<MonitorData | null>(null);
  useEffect(() => {
    let live = true;
    cache ??= load(version);
    cache.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [version]);
  return data;
}

/** MW → "132.2 GW" / "850 MW". */
export function mw(v: number, digits = 1): string {
  if (Math.abs(v) >= 1000) {
    return `${(v / 1000).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })} GW`;
  }
  return `${Math.round(v).toLocaleString("en-GB")} MW`;
}
