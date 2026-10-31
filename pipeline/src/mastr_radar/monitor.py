"""Station 3, monitor files (contract v1.3).

Three compact JSON files for the scrolling monitor page, so phones never need
the in-browser database:

- monitor/buildout.json: installed and added capacity per year, nationally and
  per district, for every technology (drives "Germany lights up").
- monitor/points.json: plants of 1 MW or more with a public location, with
  their commissioning year; planned onshore wind turbines.
- monitor/stats.json: the analyses shown in the monitor sections.

All values in MW (rounded) unless the name says otherwise.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from mastr_radar.config import MonitorSettings

TECHS = ["solar", "wind_onshore", "wind_offshore", "storage", "biomass", "hydro"]
COLUMNS = [
    "technology",
    "status",
    "capacity_kw",
    "commissioning_date",
    "shutdown_date",
    "state_key",
    "district_key",
    "lat",
    "lon",
    "operator_is_person",
    "solar_type",
    "storage_technology",
    "storage_capacity_kwh",
    "hub_height_m",
    "rotor_diameter_m",
]
SOLAR_TYPES = ["ground_mounted", "rooftop", "balcony", "other"]
STORAGE_BUCKETS = [("home", 0, 30), ("commercial", 30, 1000), ("large", 1000, float("inf"))]


class MonitorCheckError(RuntimeError):
    """The monitor files do not meet the station 3 contract (v1.3)."""


def _mw(kw) -> int:
    return int(round(float(kw) / 1000))


def _load(units_path: Path) -> pd.DataFrame:
    df = pq.read_table(units_path, columns=COLUMNS).to_pandas()
    df["y"] = pd.to_datetime(df["commissioning_date"]).dt.year
    df["m"] = pd.to_datetime(df["commissioning_date"]).dt.month
    df["sy"] = pd.to_datetime(df["shutdown_date"]).dt.year
    return df


def _yearly(df: pd.DataFrame, years: list[int]) -> dict[str, list[int]]:
    """Added, retired and installed MW per year for one set of units (non-planned)."""
    y0, y1 = years[0], years[-1]
    built = df[df["y"].notna()]
    added = built.groupby(built["y"].clip(lower=y0 - 1).astype(int))["capacity_kw"].sum()
    gone = built[built["sy"].notna()]
    retired = gone.groupby(gone["sy"].clip(lower=y0 - 1).astype(int))["capacity_kw"].sum()
    span = range(y0 - 1, y1 + 1)  # y0-1 collects everything older
    add = np.array([added.get(y, 0.0) for y in span])
    ret = np.array([retired.get(y, 0.0) for y in span])
    installed = np.cumsum(add) - np.cumsum(ret)
    return {
        "added": [_mw(v) for v in add[1:]],
        "retired": [_mw(v) for v in ret[1:]],
        "installed": [_mw(v) for v in installed[1:]],
        "units_added": [int(built[built["y"] == y].shape[0]) for y in years],
    }


def _series_units(df: pd.DataFrame) -> pd.DataFrame:
    """Units for the yearly series: not planned, and not permanently shut down
    without a shutdown date (their retirement year is unknown)."""
    unknown_exit = (df["status"] == "permanently_shut_down") & df["shutdown_date"].isna()
    return df[(df["status"] != "planned") & ~unknown_exit]


def build_buildout(df: pd.DataFrame, years: list[int]) -> dict:
    live = _series_units(df)
    national, district = {}, {}
    for tech in TECHS:
        t = live[live["technology"] == tech]
        national[tech] = _yearly(t, years)
        per = {}
        for key, g in t[t["district_key"].notna()].groupby("district_key"):
            series = _yearly(g, years)["installed"]
            if any(series):
                per[key] = series
        district[tech] = per
    return {"years": years, "techs": TECHS, "national": national, "district": district}


def build_points(df: pd.DataFrame, first_year: int, min_kw: float) -> dict:
    """Plants >= min_kw with public coordinates (never private owners, D4)."""
    public = df["lat"].notna() & ~df["operator_is_person"] & (df["capacity_kw"] >= min_kw)
    op = df[public & (df["status"] == "operating") & df["y"].notna()]
    code = {t: i for i, t in enumerate(TECHS)}
    flat = np.column_stack(
        [
            (op["lon"] * 100).round().astype(int),
            (op["lat"] * 100).round().astype(int),
            (op["y"] - first_year).clip(lower=0).astype(int),
            op["technology"].map(code).astype(int),
            (op["capacity_kw"] / 1000).round().clip(lower=1).astype(int),
        ]
    )
    pl = df[public & (df["status"] == "planned") & (df["technology"] == "wind_onshore")]
    planned = np.column_stack(
        [
            (pl["lon"] * 100).round().astype(int),
            (pl["lat"] * 100).round().astype(int),
            (pl["capacity_kw"] / 1000).round().clip(lower=1).astype(int),
        ]
    )
    return {
        "first_year": first_year,
        "techs": TECHS,
        "fields": ["lon_x100", "lat_x100", "year_offset", "tech", "mw"],
        "operating": flat.ravel().tolist(),
        "planned_onshore_fields": ["lon_x100", "lat_x100", "mw"],
        "planned_onshore": planned.ravel().tolist(),
    }


def build_stats(
    df: pd.DataFrame, as_of: date, settings: MonitorSettings, states_geo: dict, districts_geo: dict
) -> dict:
    live = _series_units(df)
    operating = df[df["status"] == "operating"]
    planned = df[df["status"] == "planned"]
    year = as_of.year

    # Year-to-date curves: cumulative MW added by month, this year and the three before.
    ytd = {}
    for tech in TECHS:
        t = live[(live["technology"] == tech) & live["y"].notna()]
        curves = {}
        for y in range(year - 3, year + 1):
            months = t[t["y"] == y].groupby("m")["capacity_kw"].sum()
            last = as_of.month if y == year else 12
            curves[str(y)] = [_mw(months.loc[:m].sum()) for m in range(1, last + 1)]
        ytd[tech] = curves

    # Solar by type: MW and units per commissioning year.
    s = live[(live["technology"] == "solar") & (live["y"] >= 2000)]
    solar_types = {
        "years": list(range(2000, year + 1)),
        "mw": {},
        "units": {},
    }
    for st in SOLAR_TYPES:
        g = s[s["solar_type"] == st].groupby("y")
        mw, n = g["capacity_kw"].sum(), g.size()
        solar_types["mw"][st] = [_mw(mw.get(y, 0)) for y in solar_types["years"]]
        solar_types["units"][st] = [int(n.get(y, 0)) for y in solar_types["years"]]

    # Wind turbines keep growing: average size of new onshore turbines per year.
    w = live[(live["technology"] == "wind_onshore") & (live["y"] >= settings.first_year)]
    g = w.groupby("y")
    turbines = {
        "years": [int(y) for y in g.size().index],
        "count": [int(v) for v in g.size().values],
        "avg_mw": [round(float(v) / 1000, 2) for v in g["capacity_kw"].mean().values],
        "avg_hub_height_m": [
            None if pd.isna(v) else round(float(v), 1) for v in g["hub_height_m"].mean().values
        ],
        "avg_rotor_diameter_m": [
            None if pd.isna(v) else round(float(v), 1) for v in g["rotor_diameter_m"].mean().values
        ],
    }

    # Storage boom: batteries added per year by size bucket (MW, MWh, units).
    b = live[
        (live["technology"] == "storage")
        & (live["storage_technology"] == "battery")
        & (live["y"] >= 2010)
    ]
    storage = {"years": list(range(2010, year + 1)), "buckets": {}}
    for name, lo, hi in STORAGE_BUCKETS:
        part = b[(b["capacity_kw"] >= lo) & (b["capacity_kw"] < hi)].groupby("y")
        storage["buckets"][name] = {
            "mw": [_mw(part["capacity_kw"].sum().get(y, 0)) for y in storage["years"]],
            "mwh": [_mw(part["storage_capacity_kwh"].sum().get(y, 0)) for y in storage["years"]],
            "units": [int(part.size().get(y, 0)) for y in storage["years"]],
        }

    # States: operating and planned MW per technology, area, density.
    area = {f["properties"]["key"]: f["properties"]["area_km2"] for f in states_geo["features"]}
    names = {f["properties"]["key"]: f["properties"]["name"] for f in states_geo["features"]}
    population = json.loads(
        (Path(__file__).resolve().parents[2] / "assets" / "population.json").read_text()
    )
    states = []
    for key in sorted(set(operating["state_key"].dropna())):
        o = operating[operating["state_key"] == key]
        p = planned[planned["state_key"] == key]
        states.append(
            {
                "key": key,
                "name": names.get(
                    key, {"OFF_N": "Nordsee (offshore)", "OFF_O": "Ostsee (offshore)"}.get(key, key)
                ),
                "area_km2": area.get(key),
                "population": population["states"].get(key),
                "operating_mw": {
                    t: _mw(o[o["technology"] == t]["capacity_kw"].sum()) for t in TECHS
                },
                "planned_mw": {t: _mw(p[p["technology"] == t]["capacity_kw"].sum()) for t in TECHS},
            }
        )

    # Top districts by MW per km², per technology (onshore technologies).
    darea = {f["properties"]["key"]: f["properties"]["area_km2"] for f in districts_geo["features"]}
    dname = {f["properties"]["key"]: f["properties"]["name"] for f in districts_geo["features"]}
    top_districts = {}
    for tech in ["solar", "wind_onshore", "storage", "biomass"]:
        o = operating[(operating["technology"] == tech) & operating["district_key"].isin(darea)]
        mw = o.groupby("district_key")["capacity_kw"].sum() / 1000
        rows = [
            {
                "key": k,
                "name": dname[k],
                "mw": round(float(v)),
                "mw_per_km2": round(float(v) / darea[k], 3),
            }
            for k, v in mw.items()
        ]
        top_districts[tech] = sorted(rows, key=lambda r: -r["mw_per_km2"])[:10]

    # Repowering candidates: onshore turbines in operation older than N years.
    on = operating[operating["technology"] == "wind_onshore"]
    old = on[on["y"] <= year - settings.repowering_age_years]
    recent = live[(live["technology"] == "wind_onshore") & (live["y"] >= year - 1)]
    repowering = {
        "age_years": settings.repowering_age_years,
        "commissioned_until": year - settings.repowering_age_years,
        "units": int(len(old)),
        "mw": _mw(old["capacity_kw"].sum()),
        "avg_mw_old": round(float(old["capacity_kw"].mean()) / 1000, 2) if len(old) else None,
        "avg_mw_new": round(float(recent["capacity_kw"].mean()) / 1000, 2) if len(recent) else None,
        "by_state": {
            k: {"units": int(len(g)), "mw": _mw(g["capacity_kw"].sum())}
            for k, g in old.groupby("state_key")
        },
    }

    installed = {
        t: _mw(operating[operating["technology"] == t]["capacity_kw"].sum()) for t in TECHS
    }
    return {
        "as_of": as_of.isoformat(),
        "installed_mw": installed,
        "targets_2030_mw": settings.targets_2030_mw,
        "ytd_cumulative_mw": ytd,
        "solar_by_type": solar_types,
        "onshore_turbines": turbines,
        "battery_storage": storage,
        "states": states,
        "top_districts": top_districts,
        "repowering": repowering,
        "planned_mw": {
            t: _mw(planned[planned["technology"] == t]["capacity_kw"].sum()) for t in TECHS
        },
    }


def _write(path: Path, data) -> int:
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    return path.stat().st_size


def build(
    units_path: Path, out_dir: Path, as_of: date, settings: MonitorSettings, boundaries_dir: Path
) -> list[dict]:
    """Write the three monitor files; return manifest file entries."""
    df = _load(units_path)
    years = list(range(settings.first_year, as_of.year + 1))
    states_geo = json.loads((boundaries_dir / "states.geojson").read_text())
    districts_geo = json.loads((boundaries_dir / "districts.geojson").read_text())
    mdir = out_dir / "monitor"
    mdir.mkdir(parents=True, exist_ok=True)

    buildout = build_buildout(df, years)
    points = build_points(df, settings.first_year, settings.point_min_kw)
    stats = build_stats(df, as_of, settings, states_geo, districts_geo)
    entries = []
    for name, data, rows in [
        ("buildout.json", buildout, len(years)),
        ("points.json", points, len(points["operating"]) // 5),
        ("stats.json", stats, len(stats)),
    ]:
        size = _write(mdir / name, data)
        entries.append({"name": f"monitor/{name}", "rows": rows, "bytes": size})
    return entries


def check(out_dir: Path, kpis: list[dict], as_of: date) -> None:
    """Station 3 check for the monitor files. Raises MonitorCheckError."""
    problems: list[str] = []
    mdir = out_dir / "monitor"
    try:
        buildout = json.loads((mdir / "buildout.json").read_text())
        points = json.loads((mdir / "points.json").read_text())
        stats = json.loads((mdir / "stats.json").read_text())
    except (OSError, ValueError) as exc:
        raise MonitorCheckError(f"monitor files missing or unreadable: {exc}") from exc

    years = buildout.get("years", [])
    if not years or years[-1] != as_of.year:
        problems.append("buildout.json: years must end with the as-of year.")
    for tech in TECHS:
        nat = buildout["national"].get(tech)
        if not nat or any(
            len(nat[k]) != len(years) for k in ("added", "retired", "installed", "units_added")
        ):
            problems.append(f"buildout.json: national series for {tech} incomplete.")
            continue
        if min(nat["added"]) < 0:
            problems.append(f"buildout.json: negative additions for {tech}.")
    # Totals match: installed at the end ≈ operating capacity in kpis.json, within 3 %.
    # The series also counts temporarily shut-down units (still installed); kpis
    # counts status 'operating' only. Biomass has the largest share (~2 %).
    for k in kpis:
        nat = buildout["national"].get(k["technology"])
        if not nat:
            continue
        want, got = k["installed_capacity_kw"] / 1000, nat["installed"][-1]
        if want > 100 and abs(got - want) / want > 0.03:
            problems.append(
                f"buildout.json: {k['technology']} installed {got} MW vs kpis {want:.0f} MW."
            )

    if len(points.get("operating", [])) % 5:
        problems.append("points.json: operating array is not a multiple of 5.")
    if len(points.get("planned_onshore", [])) % 3:
        problems.append("points.json: planned array is not a multiple of 3.")
    lons, lats = points["operating"][0::5], points["operating"][1::5]
    if lons and (min(lons) < 550 or max(lons) > 1550 or min(lats) < 4700 or max(lats) > 5600):
        problems.append("points.json: coordinates outside Germany.")

    for key in (
        "installed_mw",
        "targets_2030_mw",
        "ytd_cumulative_mw",
        "solar_by_type",
        "onshore_turbines",
        "battery_storage",
        "states",
        "top_districts",
        "repowering",
    ):
        if key not in stats:
            problems.append(f"stats.json: missing {key}.")
    if stats.get("as_of") != as_of.isoformat():
        problems.append("stats.json: as_of does not match.")
    if problems:
        raise MonitorCheckError("; ".join(problems))
