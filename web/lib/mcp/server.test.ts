// MCP server check (contract v1.10): every tool against the published files,
/* eslint-disable @typescript-eslint/no-explicit-any -- test reads loosely typed JSON-RPC results */
// the result envelope, and the read-only lock of run_sql.
import { describe, expect, it } from "vitest";

import { handleBody } from "./server";

let n = 0;
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = (await handleBody({ jsonrpc: "2.0", id: ++n, method, params })) as { result?: any; error?: any };
  return res;
}
async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  return r.result as { isError?: boolean; structuredContent: any; content: { text: string }[] };
}

function expectEnvelope(sc: any) {
  expect(sc.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(sc.contract_version).toBeTruthy();
  expect(Array.isArray(sc.source)).toBe(true);
  expect(Array.isArray(sc.licence)).toBe(true);
  expect(Array.isArray(sc.caveats)).toBe(true);
  expect(sc.data).toBeDefined();
}

describe("mcp protocol", () => {
  it("initializes and negotiates the protocol version", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.serverInfo.name).toBe("mastr-radar");
    expect(r.result.capabilities.tools).toBeDefined();
    const unknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(unknown.result.protocolVersion).toBe("2025-11-25");
  });

  it("returns nothing for notifications and errors for unknown methods", async () => {
    expect(await handleBody({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await rpc("nope")).error.code).toBe(-32601);
    expect(((await handleBody({ foo: 1 })) as any).error.code).toBe(-32600);
  });

  it("lists the v1 tools, resources and prompts", async () => {
    const tools = (await rpc("tools/list")).result.tools.map((t: any) => t.name);
    expect(tools).toEqual([
      "list_datasets", "describe_dataset", "run_sql", "get_kpis",
      "find_units", "auction_round", "auction_winners", "company_profile",
      "region_profile", "grid_redispatch", "cross_border_flows", "whats_new",
    ]);
    const res = (await rpc("resources/list")).result.resources.map((r: any) => r.uri);
    expect(res).toContain("mastr-radar://dictionary");
    for (const uri of res) {
      const c = (await rpc("resources/read", { uri })).result.contents[0];
      expect(c.text.length).toBeGreaterThan(50);
    }
    const prompts = (await rpc("prompts/list")).result.prompts;
    const p = await rpc("prompts/get", { name: prompts[0].name, arguments: { period: "March 2026" } });
    expect(p.result.messages[0].content.text).toContain("March 2026");
  });
});

describe("mcp tools", () => {
  it("list_datasets covers the files and the flat views", async () => {
    const r = await tool("list_datasets");
    expectEnvelope(r.structuredContent);
    const views = r.structuredContent.data.datasets.map((d: any) => d.view);
    for (const v of ["units", "summary", "kpis", "wind_awards", "solar_awards", "wind_rounds", "redispatch_monthly"]) expect(views).toContain(v);
  });

  it("describe_dataset gives fields, columns and samples", async () => {
    const r = await tool("describe_dataset", { name: "units" });
    const d = r.structuredContent.data;
    expect(d.fields.capacity_kw).toBeDefined();
    expect(d.columns.length).toBeGreaterThan(10);
    expect(d.sample_rows).toHaveLength(5);
    expect(d.starter_queries[0].sql).not.toContain("{data}");
    expect(r.structuredContent.licence[0]).toContain("Bundesnetzagentur");
    const missing = await tool("describe_dataset", { name: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent.error.code).toBe("not_found");
  });

  it("run_sql answers the March question with source and caveats", async () => {
    const r = await tool("run_sql", {
      sql: "SELECT technology, count(*) n, sum(capacity_kw)/1000 mw FROM units WHERE technology IN ('wind_onshore','solar') AND commissioning_date BETWEEN '2026-03-01' AND '2026-03-31' GROUP BY 1",
    });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent;
    expectEnvelope(sc);
    expect(sc.data.rows.length).toBe(2);
    expect(sc.source[0]).toContain("/data/units.parquet");
    expect(sc.caveats.join(" ")).toContain("Late registrations");
    expect(JSON.parse(r.content[0].text).as_of).toBe(sc.as_of);
  });

  it("run_sql caps rows and works on the flat award view", async () => {
    const r = await tool("run_sql", { sql: "SELECT * FROM wind_awards", max_rows: 3 });
    expect(r.structuredContent.data.row_count).toBe(3);
    expect(r.structuredContent.data.truncated).toBe(true);
    expect(r.structuredContent.data.columns).toContain("kw");
  });

  it("every starter query runs through run_sql", async () => {
    const { dictionary, viewSql } = await import("./tools");
    for (const s of dictionary().starter_queries) {
      const r = await tool("run_sql", { sql: viewSql(s.sql) });
      expect(r.isError, `${s.q}: ${r.content[0].text}`).toBeFalsy();
    }
  });

  it("run_sql refuses anything but one read-only SELECT", async () => {
    const bad = [
      "CREATE TABLE t AS SELECT 1",
      "SELECT 1; SELECT 2",
      "COPY (SELECT 1) TO '/tmp/x.csv'",
      "SELECT * FROM read_csv('/etc/passwd')",
      "SELECT * FROM 'https://example.com/x.parquet'",
      "SET enable_external_access = true",
      "INSTALL httpfs",
      "ATTACH '/tmp/a.db'",
      "SELECT getenv('HOME')",
    ];
    for (const sql of bad) {
      const r = await tool("run_sql", { sql });
      expect(r.isError, sql).toBe(true);
      expect(["query_rejected", "bad_input"]).toContain(r.structuredContent.error.code);
    }
  });

  it("get_kpis returns headline numbers", async () => {
    const r = await tool("get_kpis", { technology: "solar" });
    expect(r.structuredContent.data.kpis[0].installed_capacity_kw).toBeGreaterThan(1e7);
    expect((await tool("get_kpis")).structuredContent.data.kpis.length).toBeGreaterThan(4);
  });
});

describe("mcp typed tools (v2)", () => {
  it("find_units answers the March question without SQL", async () => {
    const r = await tool("find_units", { technology: ["wind_onshore", "solar"], commissioned_from: "2026-03-01", commissioned_to: "2026-03-31", min_mw: 1, limit: 5 });
    expect(r.isError).toBeFalsy();
    const d = r.structuredContent.data;
    expect(d.units.length).toBe(5);
    expect(d.units[0].mw).toBeGreaterThanOrEqual(d.units[4].mw);
    expect(d.totals_units_100kw_plus.length).toBeGreaterThan(0);
    const all = await tool("find_units", { technology: ["solar"], state: "Bayern", commissioned_from: "2025-01-01", commissioned_to: "2025-12-31" });
    expect(all.structuredContent.data.totals_all_sizes[0].units).toBeGreaterThan(1000);
  });

  it("auction_round and auction_winners", async () => {
    const r = await tool("auction_round", { technology: "wind" });
    expect(r.structuredContent.data.avg_ct).toBeGreaterThan(3);
    const s = await tool("auction_round", { technology: "solar", bid_date: "2025-03-01" });
    expect(s.structuredContent.data.programme).toBe("solar");
    const bad = await tool("auction_round", { technology: "wind", bid_date: "2020-01-02" });
    expect(bad.isError).toBe(true);
    const w = await tool("auction_winners", { technology: "wind", limit: 3 });
    expect(w.structuredContent.data.awards.length).toBe(3);
    const g = await tool("auction_winners", { technology: "wind", group: "RWE" });
    expect(g.structuredContent.data.total.awards).toBeGreaterThan(0);
  });

  it("company_profile, region_profile, grid and flows", async () => {
    const c = await tool("company_profile", { name: "RWE" });
    expect(c.isError).toBeFalsy();
    expect(c.structuredContent.data.wind_awards_by_year.length).toBeGreaterThan(0);
    const r = await tool("region_profile", { state: "Schleswig-Holstein" });
    expect(r.structuredContent.data.capacity.length).toBeGreaterThan(0);
    expect((await tool("region_profile", {})).isError).toBe(true);
    const g = await tool("grid_redispatch", { months: 6 });
    expect(g.structuredContent.data.monthly.length).toBe(6);
    const f = await tool("cross_border_flows", { neighbour: "FR" });
    expect(f.structuredContent.data.last_12m.FR).toBeDefined();
    expect((await tool("cross_border_flows", { neighbour: "XX" })).isError).toBe(true);
  });

  it("whats_new and input validation", async () => {
    const w = await tool("whats_new", { since: "2026-11-01" });
    expect(w.isError).toBeFalsy();
    expect(Array.isArray(w.structuredContent.data.largest)).toBe(true);
    const bad = await tool("whats_new", { since: "yesterday" });
    expect(bad.structuredContent.error.code).toBe("bad_input");
    const inj = await tool("company_profile", { name: "x' OR 1=1; DROP VIEW units; --" });
    expect(["not_found", "bad_input"]).toContain(inj.structuredContent.error.code);
  });
});
