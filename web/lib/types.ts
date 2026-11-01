// Explorer file types, mirroring docs/contracts.md (v1.6), station 3.
// If the contract changes, update these types in the same commit.

// 1.5 and 1.6 only add or extend files, so older files still load (e.g. day files until the next hub run).
export const SUPPORTED_CONTRACTS = ["1.4", "1.5", "1.6"] as const;

export type Technology =
  | "wind_onshore"
  | "wind_offshore"
  | "solar"
  | "storage"
  | "biomass"
  | "hydro";

export interface ManifestFile {
  name: string;
  rows: number;
  bytes: number;
}

export interface Manifest {
  contract_version: string;
  as_of: string; // YYYY-MM-DD, export date of the MaStR data
  generated_at: string; // UTC timestamp
  pipeline_version: string;
  incomplete_after: Partial<Record<Technology, string>>; // per technology (D10)
  files: ManifestFile[];
}

export interface Kpi {
  technology: Technology;
  installed_capacity_kw: number; // gross, status operating
  installed_units: number;
  planned_capacity_kw: number;
  added_capacity_kw_ytd: number; // commissioned since 1 Jan of the as-of year
}
