// Minimal stateless MCP server (Streamable HTTP, JSON responses), contract v1.10.
// Read-only: tools, resources and prompts over the published explorer files.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { llmsFull, type Dictionary } from "../dictionary";
import { SITE_URL } from "../site";
import { engine, readManifest } from "./engine";
import { INSTRUCTIONS, TOOLS, ToolError, callTool, dictionary } from "./tools";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const DOCS_DIR = path.join(process.cwd(), "mcp-docs");

interface RpcRequest { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> }
type RpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const ok = (id: RpcRequest["id"], result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// ---------- resources ----------

const RESOURCES = [
  { uri: "mastr-radar://dictionary", name: "dictionary", title: "Data dictionary", description: "Every dataset and field with type, unit, meaning, licence, caveats and starter queries.", mimeType: "application/json" },
  { uri: "mastr-radar://licences", name: "licences", title: "Licences and attribution", description: "Licence and required attribution line per source.", mimeType: "application/json" },
  { uri: "mastr-radar://guide", name: "guide", title: "Full data reference", description: "All datasets, fields, conventions, glossary and starter queries as text (same as /llms-full.txt).", mimeType: "text/markdown" },
  { uri: "mastr-radar://methodology", name: "methodology", title: "Methodology", description: "How the data is processed, known gaps and definitions.", mimeType: "text/markdown" },
  { uri: "mastr-radar://contract", name: "contract", title: "Data contract", description: "File-by-file contract of the published data and this MCP interface.", mimeType: "text/markdown" },
];

function readResource(uri: string): { uri: string; mimeType: string; text: string } {
  const m = readManifest();
  const d = dictionary();
  const doc = (file: string, page: string) => {
    const p = path.join(DOCS_DIR, file);
    return existsSync(p) ? readFileSync(p, "utf8") : `See ${SITE_URL}${page}`;
  };
  switch (uri) {
    case "mastr-radar://dictionary":
      return { uri, mimeType: "application/json", text: JSON.stringify(d) };
    case "mastr-radar://licences":
      return { uri, mimeType: "application/json", text: JSON.stringify(d.licences) };
    case "mastr-radar://guide":
      return { uri, mimeType: "text/markdown", text: llmsFull(d, m.as_of) };
    case "mastr-radar://methodology":
      return { uri, mimeType: "text/markdown", text: methodology(d, m.as_of) };
    case "mastr-radar://contract":
      return { uri, mimeType: "text/markdown", text: doc("contracts.md", "/open-data") };
  }
  throw new ToolError("not_found", `No resource '${uri}'.`);
}

function methodology(d: Dictionary, asOf: string): string {
  return [
    "# MaStR Radar methodology (short)",
    "",
    `Data as of ${asOf}. Full page: ${SITE_URL}/methodology`,
    "",
    "## Processing",
    "",
    "- The Bundesnetzagentur publishes the full Marktstammdatenregister export daily. MaStR Radar downloads it, decodes it into one table of units with English column names, checks it, and builds the published files. Each step is checked against a written data contract; a failed check stops the update.",
    "- Auctions come from the Bundesnetzagentur award lists; redispatch from Netztransparenz (aggregates only); cross-border flows from ENTSO-E; boundaries from BKG.",
    "",
    "## Privacy",
    "",
    "- No names or exact locations of private persons. Small units appear only as regional totals. Operator names only for legal entities and units of 1 MW or more.",
    "",
    "## Conventions",
    "",
    ...d.conventions.map((c) => `- ${c}`),
    "",
    "## Known gaps per dataset",
    "",
    ...d.datasets.filter((e) => e.caveats?.length).map((e) => `- ${e.file}: ${e.caveats!.join(" ")}`),
    "",
    "## Licences",
    "",
    ...Object.values(d.licences).map((l) => `- ${l.attribution} (${l.name}, ${l.url})`),
  ].join("\n");
}

// ---------- prompts ----------

const PROMPTS = [
  {
    name: "commissioned_in_period",
    title: "What went online, and where?",
    description: "Units commissioned in a period, by technology and region, with the late-registration caveat.",
    arguments: [
      { name: "period", description: "e.g. 'March 2026' or '2025'", required: true },
      { name: "technologies", description: "e.g. 'wind and solar' (default: all)", required: false },
    ],
  },
  {
    name: "auction_round_summary",
    title: "Auction round summary",
    description: "Volume, bids, awards, prices and winners of one auction round.",
    arguments: [
      { name: "technology", description: "wind, solar or innovation", required: true },
      { name: "bid_date", description: "e.g. '2026-08-01' (default: latest)", required: false },
    ],
  },
  {
    name: "company_profile",
    title: "Company profile",
    description: "A company's auction record, units it operates (legal entities, ≥ 1 MW) and checked facts.",
    arguments: [{ name: "company", description: "Company or group name", required: true }],
  },
];

function getPrompt(name: string, a: Record<string, string>) {
  const text: Record<string, string> = {
    commissioned_in_period: `Using the MaStR Radar tools, find which ${a.technologies || "renewable"} units went online (commissioning date) in ${a.period}. Give totals in MW by technology and by state (use 'summary' for all sizes), list the largest units (≥ 1 MW, from 'units') with district and municipality, state the as-of date and source, and warn that the most recent months are incomplete because of late registrations.`,
    auction_round_summary: `Using the MaStR Radar tools, summarise the ${a.technology} auction round ${a.bid_date ? `with bid date ${a.bid_date}` : "with the latest bid date"}: volume, bids and oversubscription, awarded MW, average and highest award price against the ceiling, and the largest winners by company group (wind_rounds/solar_rounds, wind_awards/solar_awards). Cite the source and as-of date.`,
    company_profile: `Using the MaStR Radar tools, build a short profile of ${a.company}: auction awards by year and technology (wind_awards, solar_awards, players), operating capacity it holds in the register (units ≥ 1 MW, operator_name), and checked company facts if listed. Match on the group and operator fields carefully and say when a name match may be ambiguous. Cite sources and the as-of date.`,
  };
  const t = text[name];
  if (!t) throw new ToolError("not_found", `No prompt '${name}'.`);
  return { description: PROMPTS.find((p) => p.name === name)?.description, messages: [{ role: "user", content: { type: "text", text: t } }] };
}

// ---------- dispatch ----------

const RPC_ERROR: Record<string, number> = { bad_input: -32602, not_found: -32602 };

async function handle(req: RpcRequest): Promise<RpcResponse | null> {
  const { id, method, params = {} } = req;
  const isNotification = id === undefined;
  try {
    switch (method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        const m = readManifest();
        return ok(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
          serverInfo: { name: "mastr-radar", title: "MaStR Radar", version: m.pipeline_version ?? "0", websiteUrl: SITE_URL },
          instructions: `${INSTRUCTIONS}\nData as of ${m.as_of}.`,
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const name = String(params.name ?? "");
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        if (!TOOLS.some((t) => t.name === name)) return fail(id, -32602, `Unknown tool '${name}'.`);
        // Anonymous usage count: tool name only (no IP, no arguments).
        console.info(`mcp tool ${name}`);
        try {
          const env = await callTool(name, args);
          return ok(id, { content: [{ type: "text", text: JSON.stringify(env) }], structuredContent: env });
        } catch (e) {
          const code = e instanceof ToolError ? e.code : "internal";
          const message = e instanceof ToolError ? e.message : "Internal error while running the tool.";
          if (!(e instanceof ToolError)) console.error("mcp tool error", name, e);
          const body = { error: { code, message } };
          return ok(id, { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: true });
        }
      }
      case "resources/list":
        return ok(id, { resources: RESOURCES });
      case "resources/templates/list":
        return ok(id, { resourceTemplates: [] });
      case "resources/read":
        return ok(id, { contents: [readResource(String(params.uri ?? ""))] });
      case "prompts/list":
        return ok(id, { prompts: PROMPTS });
      case "prompts/get":
        return ok(id, getPrompt(String(params.name ?? ""), (params.arguments ?? {}) as Record<string, string>));
      case "completion/complete":
        return ok(id, { completion: { values: [], hasMore: false } });
      case "logging/setLevel":
        return ok(id, {});
      default:
        if (method.startsWith("notifications/") || isNotification) return null;
        return fail(id, -32601, `Method '${method}' not found.`);
    }
  } catch (e) {
    if (e instanceof ToolError) return fail(id, RPC_ERROR[e.code] ?? -32603, e.message);
    console.error("mcp error", method, e);
    return fail(id, -32603, "Internal error.");
  }
}

/** Handle one parsed JSON-RPC body (object or batch). Null means "no response" (HTTP 202). */
export async function handleBody(body: unknown): Promise<RpcResponse | RpcResponse[] | null> {
  const one = async (r: unknown): Promise<RpcResponse | null> => {
    if (!r || typeof r !== "object" || (r as RpcRequest).jsonrpc !== "2.0" || typeof (r as RpcRequest).method !== "string") {
      // Responses from the client (e.g. to a request we never send) are ignored.
      if (r && typeof r === "object" && ("result" in r || "error" in r)) return null;
      return fail((r as RpcRequest | null)?.id, -32600, "Invalid JSON-RPC request.");
    }
    const res = await handle(r as RpcRequest);
    return (r as RpcRequest).id === undefined ? null : res;
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(one))).filter((x): x is RpcResponse => x !== null);
    return out.length ? out : null;
  }
  return one(body);
}

/** Warm the engine (used by the health check). */
export async function health() {
  try {
    const { manifest, views } = await engine();
    return { ok: true, as_of: manifest.as_of, contract_version: manifest.contract_version, views: views.length };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 200) };
  }
}
