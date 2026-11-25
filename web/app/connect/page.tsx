import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Header } from "@/components/layout/Header";
import { loadExplorerData } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Connect your AI · MaStR Radar",
  description: "Point Claude or any MCP client at MaStR Radar: a free, read-only MCP server for Germany's renewables register, auctions, costs and grid data.",
};

const MCP = `${SITE_URL}/mcp`;

function Code({ children }: { children: string }) {
  return <pre className="figures mt-3 overflow-x-auto rounded-2xl border border-rule bg-surface p-4 text-[13px] leading-relaxed"><code>{children}</code></pre>;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Option {n}</p>
      <h2 className="mt-2 text-2xl">{title}</h2>
      <div className="mt-4 space-y-3 leading-relaxed text-ink-muted">{children}</div>
    </section>
  );
}

const TOOLS: [string, string][] = [
  ["find_units", "Units by technology, status, region, size and commissioning period, with totals"],
  ["auction_round", "Results of a wind, solar or innovation auction round"],
  ["auction_winners", "Awards of a round, or all awards of a company group"],
  ["company_profile", "A company's awards, operated capacity, profile and checked facts"],
  ["region_profile", "Capacity and recent additions of a state or district"],
  ["grid_redispatch", "Monthly TSO redispatch and the most curtailed substations"],
  ["cross_border_flows", "Imports and exports per neighbouring country"],
  ["whats_new", "Units registered since a date"],
  ["get_kpis", "Headline numbers per technology"],
  ["list_datasets · describe_dataset · run_sql", "Every published file as a table, with read-only SQL (DuckDB) for everything else"],
];

export default async function ConnectPage() {
  const data = await loadExplorerData();
  const asOf = data.ok ? formatDate(data.manifest.as_of) : undefined;
  return (
    <>
      <Header asOf={asOf} wide />
      <main className="mx-auto w-full max-w-3xl px-5">
        <section className="py-10 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Open data · AI</p>
          <h1 className="mt-4 text-[2.4rem] leading-[1.04] sm:text-6xl">Connect your AI</h1>
          <p className="mt-5 text-lg text-ink-muted">
            MaStR Radar runs a free, read-only MCP server. Connect Claude or any other MCP client and ask in plain language:
            &ldquo;Which wind and solar projects went online in March 2026, and where?&rdquo; Every answer carries the data date, the source and the licence line.
          </p>
          <div className="mt-6 rounded-2xl border border-rule bg-surface p-4">
            <p className="text-sm text-ink-muted">Server address</p>
            <p className="figures mt-1 break-all text-lg font-semibold">{MCP}</p>
            <p className="mt-2 text-sm text-ink-muted">Streamable HTTP · no login · read-only · about 60 requests per minute per user</p>
          </div>
        </section>

        <Step n={1} title="Claude (web, desktop, mobile)">
          <p>Settings → Connectors → Add custom connector. Name: MaStR Radar. URL:</p>
          <Code>{MCP}</Code>
          <p>No login needed. Then enable the connector in a chat and ask your question.</p>
        </Step>

        <Step n={2} title="Claude Code">
          <Code>{`claude mcp add --transport http mastr-radar ${MCP}`}</Code>
        </Step>

        <Step n={3} title="Claude API (MCP connector)">
          <p>Pass the server in <code>mcp_servers</code> and enable its tools with an <code>mcp_toolset</code>:</p>
          <Code>{`curl https://api.anthropic.com/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $ANTHROPIC_API_KEY" \\
  -H "anthropic-version: 2026-10-21" \\
  -H "anthropic-beta: mcp-client-2025-11-20" \\
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 2000,
    "messages": [{"role": "user", "content": "Which onshore wind projects of 5 MW or more went online in Schleswig-Holstein in 2026?"}],
    "mcp_servers": [{"type": "url", "url": "${MCP}", "name": "mastr-radar"}],
    "tools": [{"type": "mcp_toolset", "mcp_server_name": "mastr-radar"}]
  }'`}</Code>
        </Step>

        <Step n={4} title="Other agents and tools">
          <p>
            Any MCP client that speaks Streamable HTTP can use the address above. Agents without MCP can read{" "}
            <a href="/llms.txt" className="text-accent underline underline-offset-2">/llms.txt</a>,{" "}
            <a href="/llms-full.txt" className="text-accent underline underline-offset-2">/llms-full.txt</a> and{" "}
            <a href="/schema.json" className="text-accent underline underline-offset-2">/schema.json</a>, and query the files on{" "}
            <a href="/open-data" className="text-accent underline underline-offset-2">Open data</a> directly (Parquet with DuckDB over HTTP; CORS is open).
          </p>
        </Step>

        <section className="border-t border-rule py-10">
          <h2 className="text-2xl">Tools</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {TOOLS.map(([t, d]) => (
              <li key={t} className="grid gap-1 sm:grid-cols-[16rem_1fr]">
                <code className="font-semibold">{t}</code>
                <span className="text-ink-muted">{d}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-ink-muted">
            Also available: resources (data dictionary, licences, full guide, methodology, data contract) and prompt templates
            (what went online in a period, auction round summary, company profile). Status: <a href="/mcp/health" className="underline underline-offset-2">/mcp/health</a>.
          </p>
          <p className="mt-3 text-sm text-ink-muted">
            Rules: data © Bundesnetzagentur (DL-DE-BY-2.0) and the other sources named in each answer; attribution is required. No names or exact locations of private persons are published.
          </p>
        </section>
      </main>
    </>
  );
}
