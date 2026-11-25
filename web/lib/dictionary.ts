// Data dictionary (contract v1.10): read at build time from
// public/data/dictionary.json, which the pipeline checks against every file.
// Feeds /llms-full.txt, /schema.json and the field lists on /open-data.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { SITE_URL } from "./site";

export interface Field { type?: string; unit?: string; desc: string }
export interface DictDataset {
  file: string;
  title: string;
  grain: string;
  licence: string;
  caveats?: string[];
  questions?: string[];
  optional?: boolean;
  fields: Record<string, Field>;
}
export interface Dictionary {
  site: string;
  data_base: string;
  conventions: string[];
  licences: Record<string, { name: string; id: string; url: string; attribution: string }>;
  glossary: Record<string, Record<string, string> | string>;
  datasets: DictDataset[];
  starter_queries: { q: string; sql: string }[];
}

export async function loadDictionary(): Promise<Dictionary | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "public", "data", "dictionary.json"), "utf8")) as Dictionary;
  } catch {
    return null;
  }
}

const dataUrl = (file: string) => `${SITE_URL}/data/${file}`;

export function llmsFull(d: Dictionary, asOf: string): string {
  const out: string[] = [
    "# MaStR Radar: full data reference for AI agents",
    "",
    `> Germany's renewables, auctions and grid from the official Marktstammdatenregister and related public sources. Data as of ${asOf}, updated daily. Short guide: ${SITE_URL}/llms.txt. Machine-readable: ${SITE_URL}/schema.json, ${SITE_URL}/data/dictionary.json, ${SITE_URL}/catalog.json.`,
    "",
    "## How to answer well",
    "",
    "- Query the files directly (Parquet with DuckDB over HTTP, JSON with any reader); CORS is open.",
    "- Always state the as-of date and the source, and add the caveat that applies (late registrations, privacy, model estimates).",
    "- Use MaStR unit IDs as keys; never join on names alone.",
    "",
    "## Conventions",
    "",
    ...d.conventions.map((c) => `- ${c}`),
    "",
    "## Glossary",
    "",
    ...Object.entries(d.glossary).map(([k, v]) => (typeof v === "string" ? `- ${k}: ${v}` : `- ${k}: ${Object.entries(v).map(([a, b]) => `${a} = ${b}`).join("; ")}`)),
    "",
    "## Datasets",
    "",
  ];
  for (const ds of d.datasets) {
    const lic = d.licences[ds.licence];
    out.push(`### ${ds.title} (${ds.file})`, "", `URL: ${ds.file.endsWith("/") ? `${dataUrl(ds.file)}YYYY-MM-DD.json` : dataUrl(ds.file)}`, `Grain: ${ds.grain}`, `Licence: ${lic?.id ?? ds.licence}. Attribution: ${lic?.attribution ?? ""}`);
    if (ds.caveats?.length) out.push(`Caveats: ${ds.caveats.join(" ")}`);
    out.push("", "Fields:");
    for (const [k, f] of Object.entries(ds.fields)) out.push(`- ${k}${f.type ? ` (${f.type}${f.unit ? `, ${f.unit}` : ""})` : f.unit ? ` (${f.unit})` : ""}: ${f.desc}`);
    if (ds.questions?.length) out.push("", `Answers questions like: ${ds.questions.join(" / ")}`);
    out.push("");
  }
  out.push("## Starter questions and queries (DuckDB SQL)", "");
  for (const s of d.starter_queries) out.push(`Q: ${s.q}`, "```sql", s.sql.replaceAll("{data}", `${SITE_URL}/data/`), "```", "");
  out.push("## Licences", "", ...Object.values(d.licences).map((l) => `- ${l.id}: ${l.name} (${l.url}). Attribution: ${l.attribution}`), "");
  return out.join("\n");
}

const TYPE_MAP: Record<string, string> = { string: "string", double: "number", int64: "integer", bool: "boolean", date: "string" };

export function jsonSchema(d: Dictionary, asOf: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "MaStR Radar datasets",
    description: `Fields of every published MaStR Radar file. Data as of ${asOf}. Full reference: ${SITE_URL}/llms-full.txt`,
    as_of: asOf,
    datasets: Object.fromEntries(
      d.datasets.map((ds) => [
        ds.file,
        {
          title: ds.title,
          url: dataUrl(ds.file),
          description: ds.grain,
          licence: d.licences[ds.licence]?.id ?? ds.licence,
          attribution: d.licences[ds.licence]?.attribution,
          type: ds.file.endsWith(".parquet") ? "table" : "object",
          properties: Object.fromEntries(
            Object.entries(ds.fields).map(([k, f]) => [
              k,
              { ...(f.type ? { type: TYPE_MAP[f.type] ?? f.type, ...(f.type === "date" ? { format: "date" } : {}) } : {}), description: f.desc, ...(f.unit ? { unit: f.unit } : {}) },
            ]),
          ),
          ...(ds.caveats?.length ? { caveats: ds.caveats } : {}),
        },
      ]),
    ),
    starter_queries: d.starter_queries.map((s) => ({ question: s.q, sql: s.sql.replaceAll("{data}", `${SITE_URL}/data/`) })),
  };
}
