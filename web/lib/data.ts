// Station 4 data access: reads only the explorer files in public/data,
// at build time. Nothing else is a data source for the website.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { SUPPORTED_CONTRACTS, type Kpi, type Manifest } from "./types";

const DATA_DIR = path.join(process.cwd(), "public", "data");

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")) as T;
}

export type ExplorerData =
  | { ok: true; manifest: Manifest; kpis: Kpi[] }
  | { ok: false; reason: string };

export async function loadExplorerData(): Promise<ExplorerData> {
  const manifest = await readJson<Manifest>("manifest.json");
  if (!(SUPPORTED_CONTRACTS as readonly string[]).includes(manifest.contract_version)) {
    return {
      ok: false,
      reason: `The data files use contract version ${manifest.contract_version}, which this version of the site does not understand.`,
    };
  }
  const kpis = await readJson<Kpi[]>("kpis.json");
  return { ok: true, manifest, kpis };
}
