"use client";

// In-browser SQL over the explorer files (station 4). DuckDB-WASM reads the
// Parquet files from /data with HTTP range requests, so only the needed parts
// are downloaded. Browser only: never import from a server component.
import * as duckdb from "@duckdb/duckdb-wasm";

export const DATA_FILES = ["units.parquet", "summary.parquet"] as const;

let connection: Promise<duckdb.AsyncDuckDBConnection> | null = null;

async function init(version: string): Promise<duckdb.AsyncDuckDBConnection> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  // A same-origin wrapper lets the worker load the CDN script.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const db = new duckdb.AsyncDuckDB(
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    new Worker(workerUrl),
  );
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  for (const name of DATA_FILES) {
    // ?v= makes each daily update a new URL, so browsers never mix old and new data.
    const url = `${window.location.origin}/data/${name}?v=${encodeURIComponent(version)}`;
    await db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);
  }
  return db.connect();
}

/** Start DuckDB once per page; `version` is the manifest's as_of date. */
export function getConnection(version: string) {
  connection ??= init(version);
  return connection;
}

/** Run a query and return plain objects (BigInts become numbers). */
export async function query<T = Record<string, unknown>>(version: string, sql: string): Promise<T[]> {
  const conn = await getConnection(version);
  const result = await conn.query(sql);
  return result.toArray().map((row) => {
    const obj = row.toJSON() as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "bigint") obj[k] = Number(v);
    }
    return obj as T;
  });
}
