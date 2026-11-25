# Open data for AI agents: design (Phase 9)

Goal: anyone can point an AI agent at MaStR Radar and get correct, sourced
answers about Germany's renewables, auctions and grid, without reading our
code.

## What exists (live)

- Static, checked files under `/data/*` (Parquet and JSON), CORS open.
- `/catalog.json` (every file with licence, rows, size) and `/llms.txt`
  (question → file map, primary-source directory), built from the manifest.
- Daily updates: MaStR, auctions, grid APIs, SMARD hub.

## Target architecture

```
data-dictionary.yaml ──▶ generated context ──▶ /llms.txt, /llms-full.txt,
 (WP75, one source)       (WP76)               /schema.json, dataset cards
                                                      │
explorer files (daily) ──▶ snapshots (WP78) ──┐       │
                                              ▼       ▼
                                   MCP server /mcp (WP80–81)
                                   Streamable HTTP, read-only, no login
                                   tools · resources · prompts
                                              │
                         Claude (custom connector), Claude Code,
                         Messages API MCP connector, other MCP clients
```

## Design rules

1. **One source of meaning.** The data dictionary defines every column once;
   docs, `llms.txt`, schemas and MCP tool descriptions are generated from it,
   so they cannot drift.
2. **Answers carry their context.** Every tool result includes `as_of`, the
   source, the licence line, and the caveat that applies (e.g. "recent
   months incomplete").
3. **Typed tools first, SQL second.** Common questions get typed tools with
   small inputs (technology, region, period). `run_sql` exists for
   everything else, read-only with limits.
4. **Same rules as the website.** Privacy (no natural persons, D4),
   aggregates only for Netztransparenz data, attribution on every answer.
5. **Contracts first.** The MCP interface (tool names and schemas) is a
   contract (v1.10) approved before code; breaking changes bump the version.

## Technical choices (WP77: measured 25 Nov 2026)

| Topic | Choice | Why |
|---|---|---|
| Transport | MCP Streamable HTTP, stateless | Current standard for remote servers; works on serverless |
| Hosting | Next.js route handler on Vercel (`/mcp`) | Same deployment as the site |
| Query engine | DuckDB (Node) over the published Parquet | Fast analytical SQL, no database to run |
| History | Daily snapshots as GitHub Release assets | Decision 2; free, versioned |
| Limits | Row cap, query timeout, rate limit | Free public service must stay up |

**WP77 result: DuckDB fits a serverless function.** `@duckdb/node-api`
2.0.0-r.1 (pinned; 2.0.1 was too new), 94 MB of packages plus 38 MB of data,
well under Vercel's 250 MB function limit. On the published files: start-up
23 ms, 154 MB memory; "wind and solar ≥ 1 MW commissioned in March 2026"
17 ms, solar by year from the summary 20 ms, top districts 5 ms, top owners
10 ms, award groups from `awards.json` 85 ms. Locked down with
`allowed_directories`, `enable_external_access = false` and
`lock_configuration`: reading `/etc/passwd`, URLs, `COPY TO`, `ATTACH`,
`INSTALL` and settings changes are all refused. Statements are additionally
limited to a single SELECT/WITH. No fallback needed; the larger files
(snapshots) go to GitHub Releases (WP78), not the function.

## How agents will connect (WP84)

- **Claude apps:** add a custom connector with the URL
  `https://mastr-radar.vercel.app/mcp`.
- **Claude Code:** `claude mcp add --transport http mastr-radar https://mastr-radar.vercel.app/mcp`
- **Claude API:** the MCP connector (`mcp_servers` with the URL plus an
  `mcp_toolset` tool).
- **Other agents:** any MCP client; agents without MCP use `/llms.txt`,
  `/schema.json` and the files directly, or an OpenAPI description.

## Open decisions

1. Snapshot storage: GitHub Release assets (default) or Hugging Face
   Datasets (browsable, larger files).
2. Budget for agent evals (WP83): Claude API costs per run.
3. Netztransparenz written permission (optional; we publish aggregates only).

## Rules that stay

- Secrets only in GitHub Secrets; never in code, chat or the repo.
- Every new source goes into `docs/sources.md` with its licence before use.
- Every new file or interface gets a contract entry and a check.
