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
  population: number | null;
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
  wind_industry: WindIndustry;
}
export interface TurbineModel {
  brand: string;
  model: string;
  units: number;
  mw: number;
  avg_mw: number;
  avg_hub_height_m: number | null;
  avg_rotor_diameter_m: number | null;
}
export interface WindIndustry {
  years: number[];
  brands: string[];
  added_mw: Record<string, number[]>;
  installed_mw: Record<string, number[]>;
  recent_models_since: number;
  recent_models: TurbineModel[];
  brand_specs: Record<
    string,
    { years: number[]; avg_mw: number[]; avg_hub_height_m: (number | null)[]; avg_rotor_diameter_m: (number | null)[] }
  >;
  unattributed_share: number;
}
export type AuctionCategory = "developer" | "utility" | "municipal" | "citizen" | "unattributed";
export interface AuctionRound {
  id: string;
  bid_date: string;
  published: string | null;
  ceiling_ct: number | null;
  volume_kw: number | null;
  min_ct: number | null;
  max_ct: number | null;
  avg_ct: number;
  awards: number | null;
  awarded_kw: number | null;
  list_kw: number;
  list_awards: number;
  kw_source: "list" | "mastr";
  kw_by_category: Record<AuctionCategory, number>;
  kw_by_maker: Record<string, number>;
  turbines: number;
  turbines_old_id: number;
  turbines_in_mastr: number;
  turbines_operating: number;
  yield_share: number;
  full_load_hours_avg: number | null;
  quality_pct_avg: number | null;
  correction_factor_avg: number | null;
  received_ct_est: number | null;
}
export interface AuctionWinner {
  group: string;
  category: AuctionCategory;
  kw: number;
  share: number;
  awards: number;
  rounds: number;
  bucket: boolean;
}
export interface AuctionDrivers {
  awarded_mw: number;
  awards: number;
  median_award_mw: number | null;
  full_load_hours_avg: number | null;
  quality_pct_avg: number | null;
  realised_share: number | null;
  median_months_to_operation: number | null;
  distinct_bidders: number;
}
export interface CompanyProfile {
  group: string;
  category: AuctionCategory;
  kw_by_year: number[];
  awards: number;
  rounds: number;
  first_bid: string;
  last_bid: string;
  median_award_mw: number;
  kw_by_state: Record<string, number>;
  states: number;
  kw_by_maker: Record<string, number>;
  full_load_hours_avg: number | null;
  quality_pct_avg: number | null;
  realised_share: number | null;
  attribution_kw: Record<"reviewed" | "name" | "office", number>;
}
export interface Auctions {
  source: string;
  categories: Record<AuctionCategory, string>;
  rounds: AuctionRound[];
  /** Per round: [MW, full-load hours, quality %, category index], best sites first. */
  merit_order: Record<string, [number, number, number, number][]>;
  winners_by_year: Record<string, AuctionWinner[]>;
  race: { years: string[]; groups: string[]; categories: AuctionCategory[]; kw: Record<string, number[]> };
  kw_by_category_year: Record<AuctionCategory, number[]>;
  operating_from_awards: { group: string; category: AuctionCategory; mw: number }[];
  fleet: {
    total_mw: number;
    groups: { group: string; category: AuctionCategory; mw: number; share: number; bucket: boolean }[];
    mw_by_category: Record<AuctionCategory, number>;
  };
  drivers: Record<AuctionCategory, AuctionDrivers>;
  drivers_realised_cutoff: string;
  company_reported: {
    group: string;
    round: string;
    bid_date: string;
    reported_mw: number;
    qualifier: "exact" | "about" | "over";
    ours_mw: number;
    note: string | null;
    source: string;
  }[];
  reviewed_awards: number;
  attribution_kw: Record<"reviewed" | "name" | "office" | "none", number>;
  /** Award locations: per round flat arrays, 6 per award (lon×100, lat×100, kW/100, category, group index, full-load hours). */
  points: { groups: string[]; rounds: Record<string, number[]> };
  kw_by_state_year: Record<string, number[]>;
  company_profiles: CompanyProfile[];
  median_award_mw: number;
  success?: {
    permits_by_year: { year: number; turbines: number; mw: number; awarded_share: number }[];
    awarded_by_quality: { band: string; turbines: number; awarded_share: number | null }[];
    awarded_by_voltage: { voltage: string; turbines: number; awarded_share: number }[];
    mature_pool_awarded_share: number | null;
    voltage_by_category: Record<string, Record<string, number>>;
    volume_vs_quality: { group: string; category: AuctionCategory; mw: number; quality_pct: number }[];
    volume_quality_spearman?: number;
  };
  unattributed_share: number;
  model: {
    wind: string;
    losses: number;
    power_coefficient: number;
    calibration?: { factor: number; n: number; correlation?: number; median_declared?: number; median_model?: number };
  };
}
export interface SolarRound {
  id: string;
  programme: "solar" | "innovation";
  bid_date: string;
  ceiling_ct: number | null;
  min_ct: number | null;
  avg_ct: number | null;
  max_ct: number | null;
  awarded_kw: number | null;
  award_level: boolean;
  list_awards: number;
  list_kw: number;
  max_award_kw: number;
  kw_by_category: Record<AuctionCategory, number> | null;
  linked_share: number | null;
  co_located_share: number | null;
  co_located_known_kw: number;
  tracker_share: number | null;
  special_share: number | null;
  specific_yield_avg: number | null;
}
export interface SolarProfile {
  group: string;
  category: AuctionCategory;
  kw_by_year: number[];
  awards: number;
  rounds: number;
  first_bid: string;
  median_award_mw: number;
  kw_by_state: Record<string, number>;
  states: number;
  co_located_share: number | null;
  tracker_share: number | null;
  specific_yield_avg: number | null;
  attribution_kw: Record<"reviewed" | "name" | "office", number>;
}
export interface SolarAuctions {
  source: string;
  categories: Record<AuctionCategory, string>;
  rounds: SolarRound[];
  winners_by_year: Record<string, AuctionWinner[]>;
  race: { years: string[]; groups: string[]; categories: AuctionCategory[]; kw: Record<string, number[]> };
  kw_by_category_year: Record<AuctionCategory, number[]>;
  kw_by_state_year: Record<string, number[]>;
  portfolios: {
    by_round: { round: string; bid_date: string; share_in_portfolios: number }[];
    largest: { owner: string | null; round: string; bid_date: string; district: string; state: string; bids: number; kw: number; max_bid_kw: number }[];
  };
  company_profiles: SolarProfile[];
  /** 7 per award: lon×100, lat×100, kW/100, category, group index, kWh/kWp, co-located (1/0/−1). */
  points: { groups: string[]; rounds: Record<string, number[]> };
  attribution_kw: Record<"reviewed" | "name" | "office" | "none", number>;
  unattributed_share: number;
  grid_voltage_kw: Record<string, number>;
  cross_tech: { group: string; category: AuctionCategory; wind_kw_since_2023: number; solar_kw_since_2023: number; first_wind: string | null; first_solar: string | null }[];
}
export interface MonitorData {
  solar: SolarAuctions | null;
  auctions: Auctions | null;
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
    get("auctions/onshore.json").catch(() => null),
    get("auctions/solar.json").catch(() => null),
  ]).then(([buildout, stats, points, districts, auctions, solar]) => ({ buildout, stats, points, districts, auctions, solar }));
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
