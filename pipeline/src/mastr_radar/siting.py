"""Siting screen for multi-asset hubs (contract v1.13, WP103) → hubs/siting.json.

Per district, factors that make a place attractive for a hub that combines
generation, storage, hydrogen and consumers, each turned into a percentile
score (0–100), and a weighted total with stated default weights (the page
lets users change them). A screening aid, not site advice.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from mastr_radar.infra import _inside, district_centroids, gazetteer, geocode, substation_place

FILE = "hubs/siting.json"
WEIGHTS = {
    "renewables": 25,      # wind + solar parks (≥ 1 MW) in operation per km²
    "curtailment": 15,     # renewables curtailed at TSO substations within 50 km
    "hydrogen": 15,        # near the hydrogen core network
    "grid": 15,            # near a ≥ 220 kV substation
    "demand": 15,          # large consumers and planned hydrogen take-off
    "gas": 15,             # near a gas transmission pipeline (backup plants, blending)
}  # fmt: skip
LABELS = {
    "renewables": "Wind and solar parks per km²",
    "curtailment": "Curtailed renewables nearby",
    "hydrogen": "Hydrogen core network nearby",
    "grid": "Extra-high-voltage substation nearby",
    "demand": "Large consumers and hydrogen demand",
    "gas": "Gas pipeline nearby",
}


class SitingCheckError(Exception):
    """Raised when the siting file breaks the contract."""


def _km(a, b) -> float:
    return math.hypot((a[0] - b[0]) * 111.2 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 111.2)


def _points_of_lines(
    lines: list[list[list[float]]], step_km: float = 5
) -> list[tuple[float, float]]:
    pts = []
    for ln in lines:
        for p, q in zip(ln, ln[1:], strict=False):
            n = max(1, int(_km(p, q) / step_km))
            for i in range(n + 1):
                pts.append((p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n))
    return pts


def _nearest(c, pts) -> float | None:
    return round(min(_km(c, p) for p in pts), 1) if pts else None


def build(extract_dir: Path, out_dir: Path, as_of) -> list[dict]:
    geo = json.loads((out_dir / "boundaries" / "districts.geojson").read_text())
    cent = district_centroids(out_dir / "boundaries")
    infra = json.loads((out_dir / "hubs" / "infrastructure.json").read_text())
    hubs = json.loads((out_dir / "hubs" / "hubs.json").read_text())["hubs"]
    s = pq.read_table(out_dir / "summary.parquet").to_pandas()
    big = s.size_class.isin(["1–10 MW", "≥10 MW"])
    ren_mask = (s.status == "operating") & (
        (s.technology == "wind_onshore") | ((s.technology == "solar") & big)
    )
    ren = s[ren_mask].groupby("district_key").capacity_kw.sum() / 1000
    o = pq.read_table(extract_dir / "assets_other.parquet").to_pandas()
    o = o[o.status.isin(["operating", "planned"])]
    h2_lines = [sg["coords"] for sg in infra["hydrogen"]["segments"] if sg["coords"]]
    h2_pts = _points_of_lines(h2_lines)
    gas_pts = _points_of_lines([g[1] for g in infra["gas"]], step_km=10)
    subs = [(x[0], x[1]) for x in infra["power"]["substations"]]
    # curtailment: TSO substations with curtailed renewables (last 12 months)
    rd = json.loads((out_dir / "grid" / "redispatch.json").read_text())["last_12m"].get(
        "renewable_substations", []
    )
    gpath = extract_dir.parent / "infra" / "geocode.json"
    extra = json.loads(gpath.read_text()) if gpath.exists() else {}
    gaz = gazetteer(extract_dir)
    curt = []
    for x in rd:
        c = geocode(substation_place(x["asset"]), gaz, extra)
        if c:
            curt.append((c, x["mwh"] / 1000))
    h2p = [p for p in infra["hydrogen"]["projects"] if p["lat"] is not None]
    rows = []
    for f in geo["features"]:
        key, name = str(f["properties"]["key"]), str(f["properties"]["name"])
        km2 = float(f["properties"].get("area_km2") or 1)
        c = cent[name.lower()]
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        rings = [poly[0] for poly in polys]
        lc = o[(o.kind == "large_consumer") & o.lon.notna()]
        n_cons = int(sum(_inside(x, y, rings) for x, y in zip(lc.lon, lc.lat, strict=True)))
        take = sum((p["take_off_mw"] or 0) for p in h2p if _km(c, (p["lon"], p["lat"])) < 25)
        elec = sum((p["electrolysis_mw"] or 0) for p in h2p if _km(c, (p["lon"], p["lat"])) < 25)
        rows.append({
            "key": key, "name": name, "lon": round(c[0], 3), "lat": round(c[1], 3),
            "renewables_mw_km2": round(float(ren.get(key, 0)) / km2, 3),
            "curtailed_gwh_50km": round(sum(g for p, g in curt if _km(c, p) <= 50), 1),
            "h2_km": _nearest(c, h2_pts),
            "substation_km": _nearest(c, subs),
            "gas_km": _nearest(c, gas_pts),
            "large_consumers": n_cons,
            "h2_take_off_mw_25km": round(take, 1),
            "h2_electrolysis_mw_25km": round(elec, 1),
            "hubs": sum(1 for h in hubs if _inside(h["lon"], h["lat"], rings)),
        })  # fmt: skip
    df = pd.DataFrame(rows)

    def pct(series: pd.Series, higher_better=True) -> pd.Series:
        r = series.rank(pct=True, method="average")
        return ((r if higher_better else 1 - r + 1 / len(series)) * 100).round(0)

    df["s_renewables"] = pct(df.renewables_mw_km2)
    df["s_curtailment"] = pct(df.curtailed_gwh_50km)
    df["s_hydrogen"] = pct(df.h2_km.fillna(999), higher_better=False)
    df["s_grid"] = pct(df.substation_km.fillna(999), higher_better=False)
    df["s_demand"] = pct(df.large_consumers + df.h2_take_off_mw_25km / 50)
    df["s_gas"] = pct(df.gas_km.fillna(999), higher_better=False)
    tot = sum(WEIGHTS.values())
    df["score"] = sum(df[f"s_{k}"] * w for k, w in WEIGHTS.items()) / tot
    df["score"] = df.score.round(0)
    df = df.sort_values("score", ascending=False)
    out = {
        "as_of": str(as_of),
        "weights": WEIGHTS,
        "labels": LABELS,
        "method": (
            "Each factor is the district's percentile among all 401 districts "
            "(0–100); the score is the weighted mean. Distances from the district "
            "centre. Curtailment: TSO substations with the most curtailed "
            "renewables in the last 12 months (Netztransparenz aggregates). "
            "Hydrogen core network drawn schematically."
        ),
        "districts": df.to_dict("records"),
    }
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return [{"name": FILE, "rows": len(df), "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems = []
    ds = d.get("districts", [])
    if len(ds) < 390:
        problems.append(f"only {len(ds)} districts.")
    for r in ds:
        for k in d["weights"]:
            if not 0 <= r[f"s_{k}"] <= 100:
                problems.append(f"{r['name']}: score {k} out of range.")
                break
        if not 0 <= r["score"] <= 100:
            problems.append(f"{r['name']}: total out of range.")
    if problems:
        raise SitingCheckError("Siting check failed:\n- " + "\n- ".join(problems[:10]))
