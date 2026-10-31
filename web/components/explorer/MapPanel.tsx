"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { summaryWhere, unitsWhere, type Filters } from "@/lib/filters";
import { formatCount, formatPower, TECHNOLOGY_LABELS } from "@/lib/format";
import { BASEMAP, cssVar, TECH_CSS_VAR, TECHNOLOGIES } from "@/lib/theme";
import type { Technology } from "@/lib/types";
import { useQuery } from "@/lib/useQuery";

type Mode = "units" | "regions";

interface UnitPoint {
  unit_id: string;
  technology: Technology;
  capacity_kw: number;
  lat: number;
  lon: number;
  name: string | null;
  operator_name: string | null;
  municipality: string | null;
  commissioning_date: string | number | null;
}
interface RegionValue {
  key: string;
  capacity_kw: number;
  units: number;
}

const GERMANY: [[number, number], [number, number]] = [
  [5.6, 47.2],
  [15.2, 55.2],
];

function andWhere(where: string, extra: string) {
  return where ? `${where} AND ${extra}` : `WHERE ${extra}`;
}

function usePrefersDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return dark;
}

function techColorExpression() {
  const pairs = TECHNOLOGIES.flatMap((t) => [t, cssVar(TECH_CSS_VAR[t])]);
  return ["match", ["get", "technology"], ...pairs, "#888"];
}

function dateText(v: UnitPoint["commissioning_date"]) {
  if (v == null) return "not yet online";
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return d.toISOString().slice(0, 10);
}

export function MapPanel({ version, filters }: { version: string; filters: Filters }) {
  const [mode, setMode] = useState<Mode>("units");
  const dark = usePrefersDark();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);

  const unitsSql = useMemo(
    () =>
      `SELECT unit_id, technology, capacity_kw, lat, lon, name, operator_name, municipality,
              commissioning_date
       FROM 'units.parquet' ${andWhere(unitsWhere(filters), "lat IS NOT NULL")}
       ORDER BY capacity_kw`,
    [filters],
  );
  const hiddenSql = useMemo(
    () =>
      `SELECT count(*) AS n FROM 'units.parquet' ${andWhere(unitsWhere(filters), "lat IS NULL")}`,
    [filters],
  );
  const regionsSql = useMemo(
    () =>
      `SELECT district_key AS key, sum(capacity_kw) AS capacity_kw, sum(unit_count)::DOUBLE AS units
       FROM 'summary.parquet' ${summaryWhere(filters)} GROUP BY 1`,
    [filters],
  );

  const points = useQuery<UnitPoint>(version, unitsSql);
  const hidden = useQuery<{ n: number }>(version, hiddenSql);
  const regions = useQuery<RegionValue>(version, regionsSql);

  // Create the map once, and again when light/dark mode changes.
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker-${maplibregl.getVersion()}.mjs`);
      const m = new maplibregl.Map({
        container: container.current,
        style: dark ? BASEMAP.dark : BASEMAP.light,
        bounds: GERMANY,
        attributionControl: { compact: true, customAttribution: "© GeoBasis-DE / BKG" },
      });
      map = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", async () => {
        if (!map) return;
        const districts = await fetch(`/data/boundaries/districts.geojson?v=${version}`).then(
          (r) => r.json(),
        );
        map.addSource("regions", { type: "geojson", data: districts, promoteId: "key" });
        map.addLayer({
          id: "regions-fill",
          type: "fill",
          source: "regions",
          paint: { "fill-color": cssVar("--accent"), "fill-opacity": 0 },
        });
        map.addLayer({
          id: "regions-line",
          type: "line",
          source: "regions",
          paint: { "line-color": cssVar("--rule"), "line-width": 0.5, "line-opacity": 0 },
        });
        map.addSource("units", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "units",
          type: "circle",
          source: "units",
          paint: {
            "circle-color": techColorExpression() as never,
            "circle-opacity": 0.75,
            "circle-stroke-width": 0.3,
            "circle-stroke-color": cssVar("--paper"),
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              ["interpolate", ["linear"], ["sqrt", ["get", "mw"]], 0, 1, 3, 2.5, 30, 7, 300, 16],
              10,
              ["interpolate", ["linear"], ["sqrt", ["get", "mw"]], 0, 2.5, 3, 6, 30, 16, 300, 30],
            ] as never,
          },
        });
        map.on("click", "units", (e) => {
          const p = e.features?.[0]?.properties as Record<string, string | number> | undefined;
          if (!p) return;
          const html = `<div style="font:13px/1.4 system-ui;color:#1a1816">
            <strong>${p.name ?? "Unit"}</strong><br/>
            ${TECHNOLOGY_LABELS[p.technology as Technology]} · ${formatPower(Number(p.kw))}<br/>
            ${p.municipality ?? ""}${p.operator ? `<br/>Operator: ${p.operator}` : ""}<br/>
            Online: ${p.date}<br/><span style="color:#5f5a53">${p.id}</span></div>`;
          new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(html).addTo(map!);
        });
        map.on("mouseenter", "units", () => (map!.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "units", () => (map!.getCanvas().style.cursor = ""));
        mapRef.current = map;
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
      mapRef.current = null;
      setReady(false);
      map?.remove();
    };
  }, [dark, version]);

  // Unit points.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !points.data) return;
    (map.getSource("units") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: points.data.map((u) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [u.lon, u.lat] },
        properties: {
          id: u.unit_id,
          technology: u.technology,
          mw: u.capacity_kw / 1000,
          kw: u.capacity_kw,
          name: u.name,
          operator: u.operator_name,
          municipality: u.municipality,
          date: dateText(u.commissioning_date),
        },
      })),
    });
  }, [ready, points.data]);

  // Region shading: five steps by capacity, from paper to accent.
  const breaks = useMemo(() => {
    const vals = (regions.data ?? []).map((r) => r.capacity_kw).filter((v) => v > 0).sort((a, b) => a - b);
    if (!vals.length) return [];
    return [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.floor(q * (vals.length - 1))]);
  }, [regions.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.removeFeatureState({ source: "regions" });
    for (const r of regions.data ?? []) {
      if (r.key) map.setFeatureState({ source: "regions", id: r.key }, { cap: r.capacity_kw });
    }
    const steps = breaks.flatMap((b, i) => [b, 0.25 + 0.15 * (i + 1)]);
    map.setPaintProperty("regions-fill", "fill-opacity", (mode === "regions"
      ? ["case", ["==", ["feature-state", "cap"], null], 0.03, ["step", ["feature-state", "cap"], 0.2, ...steps]]
      : 0) as never);
    map.setPaintProperty("regions-line", "line-opacity", mode === "regions" ? 1 : 0);
    map.setLayoutProperty("units", "visibility", mode === "units" ? "visible" : "none");
  }, [ready, regions.data, breaks, mode]);

  const shown = points.data?.length ?? 0;
  const capShown = (points.data ?? []).reduce((s, u) => s + u.capacity_kw, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-full border border-rule p-0.5 text-sm">
          {(["units", "regions"] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 ${mode === m ? "bg-ink text-paper" : "text-ink-muted"}`}
            >
              {m === "units" ? "Units ≥ 100 kW" : "By district (all units)"}
            </button>
          ))}
        </div>
        <p className="figures text-sm text-ink-muted" aria-live="polite">
          {points.loading || regions.loading
            ? "Loading…"
            : mode === "units"
              ? `${formatCount(shown)} units · ${formatPower(capShown)}`
              : `${formatCount((regions.data ?? []).reduce((s, r) => s + r.units, 0))} units in ${formatCount(
                  (regions.data ?? []).filter((r) => r.key).length,
                )} districts`}
        </p>
      </div>
      <div ref={container} className="h-[60vh] min-h-[360px] w-full overflow-hidden rounded border border-rule" />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {mode === "units" ? (
          <>
            {TECHNOLOGIES.map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${TECH_CSS_VAR[t]})` }} />
                {TECHNOLOGY_LABELS[t]}
              </span>
            ))}
            <span>Dot size = capacity.</span>
            {!!hidden.data?.[0]?.n && (
              <span>
                {formatCount(hidden.data[0].n)} units without a public location (private owners) are
                counted in the district view only.
              </span>
            )}
          </>
        ) : (
          <span className="figures">
            Darker = more capacity. Steps at{" "}
            {breaks.map((b) => formatPower(b)).join(", ") || "–"}. Offshore wind is not part of any
            district.
          </span>
        )}
      </div>
    </div>
  );
}
