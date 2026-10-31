import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";
import { buildCatalog } from "@/lib/catalog";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Open data · MaStR Radar",
  description:
    "Download or query MaStR Radar's cleaned data: every renewable unit in Germany, build-out series, quarter-hourly generation and demand, weather. Free, with stable links for people and AI agents.",
};

function size(bytes?: number) {
  if (bytes == null) return "";
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

export default async function OpenData() {
  const c = await buildCatalog();
  return (
    <>
      <Header asOf={c.as_of !== "unknown" ? formatDate(c.as_of) : undefined} wide />
      <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Open data</p>
        <h1 className="mt-3 max-w-3xl text-4xl leading-[1.05] sm:text-6xl">All the data, one address</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">
          Cleaned, checked and updated every day. Fetch the files directly, query the Parquet files
          remotely, or point your AI agent at <code className="rounded bg-surface px-1.5">/llms.txt</code>.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <a href="/catalog.json" className="rounded-[20px] bg-surface p-5 hover:bg-rule">
            <p className="font-bold">catalog.json</p>
            <p className="text-sm text-ink-muted">Machine-readable list of every dataset</p>
          </a>
          <a href="/llms.txt" className="rounded-[20px] bg-surface p-5 hover:bg-rule">
            <p className="font-bold">llms.txt</p>
            <p className="text-sm text-ink-muted">Plain-text guide for AI agents</p>
          </a>
          <a href={c.contract_url} className="rounded-[20px] bg-surface p-5 hover:bg-rule">
            <p className="font-bold">Data contract v{c.contract}</p>
            <p className="text-sm text-ink-muted">Every field, unit and rule</p>
          </a>
        </div>

        <h2 className="mt-14 text-3xl">Datasets</h2>
        <div className="mt-5 divide-y divide-rule border-y border-rule">
          {c.datasets.map((d) => (
            <div key={d.id} className="grid gap-2 py-5 sm:grid-cols-[1fr_auto] sm:gap-6">
              <div>
                <p className="font-bold">{d.title}</p>
                <p className="mt-1 text-sm text-ink-muted">{d.description}</p>
                <p className="mt-2 text-xs text-ink-muted">
                  {d.format.toUpperCase()} · {d.rows != null ? `${d.rows.toLocaleString("en-GB")} rows · ` : ""}
                  {size(d.bytes)} · updated {d.update} ·{" "}
                  <a className="underline" href={d.licence.url}>
                    {d.licence.id}
                  </a>{" "}
                  · {d.attribution}
                </p>
              </div>
              <a href={d.url} className="self-start rounded-full border border-rule px-4 py-1.5 text-sm font-semibold hover:border-ink">
                Download
              </a>
            </div>
          ))}
          <div className="py-5">
            <p className="font-bold">Day files: Germany in 24 hours</p>
            <p className="mt-1 text-sm text-ink-muted">
              One file per day from {c.day_files.first} to {c.day_files.last} ({c.day_files.count} days):
              quarter-hourly generation per technology and demand (MW) for Germany and the 4 grid
              areas, hourly radiation and wind per weather station.
            </p>
            <p className="mt-2 font-mono text-xs text-ink-muted">{c.day_files.url_template}</p>
            <p className="mt-1 text-xs text-ink-muted">CC-BY-4.0 · Bundesnetzagentur | SMARD.de; Deutscher Wetterdienst</p>
          </div>
        </div>

        <h2 className="mt-14 text-3xl">Quick start</h2>
        <div className="mt-5 grid gap-4">
          {Object.entries(c.how_to).map(([lang, code]) => (
            <div key={lang}>
              <p className="text-sm font-semibold text-ink-muted">{lang === "duckdb" ? "DuckDB (SQL)" : lang === "python" ? "Python (pandas)" : "Command line"}</p>
              <pre className="mt-1 overflow-x-auto rounded-[16px] bg-surface p-4 text-sm">
                <code>{code}</code>
              </pre>
            </div>
          ))}
        </div>

        <p className="mt-12 max-w-2xl text-sm text-ink-muted">
          Please name the sources when you reuse the data, as listed for each dataset. Wholesale
          electricity prices are deliberately not included. Units of private individuals have no
          name, operator or coordinates.
        </p>
      </main>
    </>
  );
}
