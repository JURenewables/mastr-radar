"use client";

import { useEffect, useState } from "react";

import { query } from "./duckdb";

export interface QueryState<T> {
  data: T[] | null;
  error: string | null;
  loading: boolean;
}

/** Run `sql` in DuckDB whenever it changes; stale answers are ignored. */
export function useQuery<T>(version: string, sql: string): QueryState<T> {
  const [result, setResult] = useState<{ sql: string; data: T[] | null; error: string | null }>(
    { sql: "", data: null, error: null },
  );

  useEffect(() => {
    let current = true;
    query<T>(version, sql).then(
      (data) => current && setResult({ sql, data, error: null }),
      (err: unknown) => current && setResult({ sql, data: null, error: String(err) }),
    );
    return () => {
      current = false;
    };
  }, [version, sql]);

  // While a new query runs, keep showing the previous data (no flicker).
  return { data: result.data, error: result.error, loading: result.sql !== sql };
}
