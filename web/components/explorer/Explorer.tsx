"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { filtersToParams, parseFilters, summaryWhere, type Filters } from "@/lib/filters";
import { formatCount, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import type { Technology } from "@/lib/types";
import { useQuery } from "@/lib/useQuery";

import { BuildoutChart, RegionRanking, SizeChart } from "./Charts";
import { FilterBar } from "./FilterBar";
import { UnitsTable } from "./UnitsTable";

// The map needs the browser (WebGL), so it is never rendered on the server.
const MapPanel = dynamic(() => import("./MapPanel").then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <div className="h-[60vh] min-h-[360px] rounded border border-rule" />,
});

interface TechTotal {
  technology: Technology;
  units: number;
  capacity_kw: number;
}

function SelectionTotals({ version, filters }: { version: string; filters: Filters }) {
  const { data, loading, error } = useQuery<TechTotal>(
    version,
    `SELECT technology, sum(unit_count)::DOUBLE AS units, sum(capacity_kw) AS capacity_kw
     FROM 'summary.parquet' ${summaryWhere(filters)} GROUP BY 1 ORDER BY 3 DESC`,
  );
  if (error) {
    return <p className="text-sm text-accent">Could not load the data: {error}</p>;
  }
  const total = (data ?? []).reduce((s, r) => s + r.capacity_kw, 0);
  const units = (data ?? []).reduce((s, r) => s + r.units, 0);
  return (
    <div className={loading ? "opacity-60" : ""} aria-live="polite">
      <p className="figures font-serif text-3xl sm:text-4xl">
        {data ? formatPower(total) : "…"}
        <span className="ml-2 text-base font-sans text-ink-muted">in {formatCount(units)} units</span>
      </p>
      <ul className="figures mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
        {(data ?? []).map((r) => (
          <li key={r.technology}>
            {TECHNOLOGY_LABELS[r.technology]} {formatPower(r.capacity_kw)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Explorer({
  asOf,
  incompleteAfter,
}: {
  asOf: string; // YYYY-MM-DD
  incompleteAfter: Partial<Record<Technology, string>>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(params.toString())), [params]);
  const setFilters = useCallback(
    (f: Filters) => {
      const qs = filtersToParams(f).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // The earliest "possibly incomplete" date among the selected technologies.
  const techs = filters.tech.length ? filters.tech : (Object.keys(incompleteAfter) as Technology[]);
  const incomplete =
    techs
      .map((t) => incompleteAfter[t])
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null;

  const version = asOf;
  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <SelectionTotals version={version} filters={filters} />
          <FilterBar filters={filters} onChange={setFilters} asOf={asOf} />
        </div>
        <MapPanel version={version} filters={filters} />
      </section>
      <BuildoutChart version={version} filters={filters} asOf={asOf} incompleteAfter={incomplete} />
      <div className="grid gap-12 lg:grid-cols-2">
        <SizeChart version={version} filters={filters} asOf={asOf} />
        <RegionRanking version={version} filters={filters} asOf={asOf} />
      </div>
      <UnitsTable version={version} filters={filters} asOf={asOf} />
    </div>
  );
}
