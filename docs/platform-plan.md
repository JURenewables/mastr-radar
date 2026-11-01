# AI-friendly data platform: plan (WP73)

Goal: "Point your AI at mastr-radar.vercel.app and it finds the answer."

## Principle

The site already is the platform. Every dataset is a static file with a
contract, a check and a stable URL. AI agents work best with:

1. **One entry point**: `/llms.txt`, a plain-text map of what exists, which
   file answers which question, and how to go deeper. Done (WP73a).
2. **A machine-readable catalogue**: `/catalog.json` with licence,
   attribution, rows, size and URL per file. Done.
3. **Query-ready files**: Parquet over HTTP (DuckDB `read_parquet('https://…')`)
   and small JSON. Done; CORS open on `/data/*`.
4. **A primary-source directory**: what MaStR, SMARD, Netztransparenz,
   ENTSO-E, BNetzA auctions, DWD and BKG offer and how to access them.
   Done on `/open-data` and in `/llms.txt`.

## Next steps

| Step | What | Needs |
|---|---|---|
| A | Netztransparenz station: EEG plant data, redispatch by grid element, curtailment, market values → `grid/redispatch.json` (lines and areas most often congested) | `NETZTRANSPARENZ_CLIENT_ID` / `_SECRET` in GitHub Secrets (rotate the one pasted in chat) |
| B | ENTSO-E station: hourly load, generation, cross-border flows → day files and a flows chart on `/grid` | `ENTSOE_TOKEN` in GitHub Secrets |
| C | OpenStreetMap grid topology (lines, substations) → line map and plant-to-substation distance (WP41, WP67) | Your decision to accept the ODbL licence |
| D | Query endpoint (MCP server on Vercel): tools `list_datasets`, `describe(file)`, `sql(query)` over the Parquet files with DuckDB | Small serverless function; no secrets |
| E | Reports index: links to BNetzA monitoring reports, network development plan, EEG reports, with a one-line summary each | Hand-curated YAML with sources |

## Rules that stay

- Secrets only in GitHub Secrets; never in code, chat or the repo.
- Every new source goes into `docs/sources.md` with its licence before use.
- Every new file gets a contract entry and a check (a broken station never
  reaches the website).
