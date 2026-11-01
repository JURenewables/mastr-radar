"""Grid view (contract v1.7 draft, WP71) → grid/grid.json (station 3).

Reads station 2 outputs: units.parquet, unit_details.parquet (large units),
grid_units.parquet (grid operator, TSO control area, voltage per unit),
grid_operators.parquet, consumers.parquet, operators.parquet (names of
organisations), plus the hand-checked context in config/grid_facts.yaml.
Covers large units only: all onshore wind, ground-mounted or ≥ 100 kW solar,
storage ≥ 100 kW.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

import pandas as pd
import yaml

from mastr_radar.config import PIPELINE_ROOT

FACTS_PATH = PIPELINE_ROOT / "config" / "grid_facts.yaml"
FILE = "grid/grid.json"
TECHS = ("wind_onshore", "solar", "storage")
AREAS = ("50Hertz", "Amprion", "TenneT", "TransnetBW")
VOLTAGES = (
    "extra_high",
    "extra_high_to_high",
    "high",
    "high_to_medium",
    "medium",
    "medium_to_low",
    "low",
)
URL = re.compile(r"^https://\S+$")


class GridCheckError(Exception):
    """Raised when grid.json breaks the contract."""


def _kw(df: pd.DataFrame, by: str) -> dict:
    t = df.pivot_table(index=by, columns="technology", values="capacity_kw", aggfunc="sum")
    t = t.reindex(columns=list(TECHS)).fillna(0)
    return {k: {tech: round(float(t.loc[k, tech])) for tech in TECHS} for k in t.index}


def build(
    extract_dir: Path, out_dir: Path, as_of: date, facts_path: Path = FACTS_PATH
) -> list[dict]:
    units = pd.read_parquet(
        extract_dir / "units.parquet",
        columns=["unit_id", "status", "capacity_kw", "district_key"],
    )
    details = pd.read_parquet(
        extract_dir / "unit_details.parquet", columns=["unit_id", "technology"]
    )
    gu = pd.read_parquet(extract_dir / "grid_units.parquet")
    ops = pd.read_parquet(extract_dir / "grid_operators.parquet")
    cons = pd.read_parquet(extract_dir / "consumers.parquet")
    names = pd.read_parquet(extract_dir / "operators.parquet", columns=["operator_id", "name"])
    names = names.set_index("operator_id")["name"]

    df = details.merge(units, on="unit_id").merge(gu, on="unit_id", how="left")
    live = df[df["status"] == "operating"]
    planned = df[df["status"] == "planned"]
    total = float(live["capacity_kw"].sum())
    known = live[live["grid_operator_id"].notna()]

    areas = _kw(known[known["control_area"].isin(AREAS)], "control_area")
    planned_areas = _kw(planned[planned["control_area"].isin(AREAS)], "control_area")
    cons_live = cons[cons["status"] == "operating"]
    cons_plan = cons[cons["status"] == "planned"]
    control_areas = [
        {
            "name": a,
            "kw": areas.get(a, dict.fromkeys(TECHS, 0)),
            "planned_kw": planned_areas.get(a, dict.fromkeys(TECHS, 0)),
            "consumers_operating": int((cons_live["control_area"] == a).sum()),
            "consumers_planned": int((cons_plan["control_area"] == a).sum()),
        }
        for a in AREAS
    ]

    by_op = known.groupby("grid_operator_id")["capacity_kw"].sum().sort_values(ascending=False)
    tech_op = _kw(known, "grid_operator_id")
    hv = known[known["voltage"].isin(VOLTAGES[:4])].groupby("grid_operator_id")["capacity_kw"].sum()
    n_units = known.groupby("grid_operator_id").size()
    tso_ids = set(ops.loc[ops["tso"], "operator_id"])
    top = [
        {
            "name": names.get(oid, oid),
            "tso": oid in tso_ids,
            "kw": tech_op[oid],
            "units": int(n_units[oid]),
            "share": round(float(kw) / float(by_op.sum()), 4),
            "high_voltage_share": round(float(hv.get(oid, 0)) / float(kw), 3) if kw else None,
        }
        for oid, kw in by_op.head(25).items()
    ]
    shares = by_op / by_op.sum()
    operators = {
        "registered": int(len(ops)),
        "tsos": int(ops["tso"].sum()),
        "with_large_units": int(len(by_op)),
        "top10_share": round(float(shares.head(10).sum()), 4),
        "operators_for_half": int((shares.cumsum() < 0.5).sum() + 1),
        "top": top,
    }

    voltage = _kw(known[known["voltage"].isin(VOLTAGES)], "voltage")
    voltage_rows = [{"level": v, "kw": voltage.get(v, dict.fromkeys(TECHS, 0))} for v in VOLTAGES]

    # District map: dominant control area (by capacity) and large renewable kW.
    dk = known[known["control_area"].isin(AREAS) & known["district_key"].notna()]
    area_kw = dk.groupby(["district_key", "control_area"])["capacity_kw"].sum().reset_index()
    dom = area_kw.sort_values("capacity_kw").groupby("district_key").tail(1)
    re_kw = dk[dk["technology"] != "storage"].groupby("district_key")["capacity_kw"].sum()
    st_kw = dk[dk["technology"] == "storage"].groupby("district_key")["capacity_kw"].sum()
    districts = {
        r.district_key: [
            AREAS.index(r.control_area),
            round(float(re_kw.get(r.district_key, 0))),
            round(float(st_kw.get(r.district_key, 0))),
        ]
        for r in dom.itertuples()
    }

    pts = cons[cons["status"].isin(["operating", "planned"])].dropna(subset=["lat", "lon"])
    big = cons["units_over_50mw"].fillna(0) > 0
    year = cons_plan["planned_date"].dropna().map(lambda d: d.year)
    consumers = {
        "operating": int(len(cons_live)),
        "planned": int(len(cons_plan)),
        "sites_with_units_over_50mw": int(
            (big & cons["status"].isin(["operating", "planned"])).sum()
        ),
        "by_state": {
            s: [int((cons_live["state"] == s).sum()), int((cons_plan["state"] == s).sum())]
            for s in sorted(cons["state"].dropna().unique())
        },
        "planned_by_year": {
            str(int(y)): int(n) for y, n in year.value_counts().sort_index().items()
        },
        # lon×100, lat×100, status (1 operating, 2 planned), 1 if it has units over 50 MW
        "points": [
            v
            for r in pts.itertuples()
            for v in (
                round(r.lon * 100),
                round(r.lat * 100),
                1 if r.status == "operating" else 2,
                1 if (r.units_over_50mw or 0) > 0 else 0,
            )
        ],
    }

    facts = yaml.safe_load(facts_path.read_text())
    out = {
        "as_of": as_of.isoformat(),
        "scope": "Onshore wind, ground-mounted or ≥ 100 kW solar, storage ≥ 100 kW",
        "coverage_share": round(float(known["capacity_kw"].sum()) / total, 4) if total else None,
        "control_areas": control_areas,
        "operators": operators,
        "voltage": voltage_rows,
        "areas": list(AREAS),
        "districts": districts,
        "consumers": consumers,
        "context": facts,
    }
    check_data(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=str, allow_nan=False)
    )
    return [{"name": FILE, "rows": len(districts), "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    check_data(json.loads((out_dir / FILE).read_text()))


def check_data(d: dict) -> None:
    problems = []
    if [a["name"] for a in d["control_areas"]] != list(AREAS):
        problems.append("control_areas must be the four TSO areas.")
    if not 0.5 <= (d["coverage_share"] or 0) <= 1:
        problems.append(f"coverage_share {d['coverage_share']} below 50 %: grid join broken?")
    op = d["operators"]
    if not 3 <= op["tsos"] <= 6 or op["registered"] < 500:
        problems.append("operators: unexpected TSO or operator count.")
    if len(d["districts"]) < 300:
        problems.append(f"only {len(d['districts'])} districts with grid data.")
    if len(d["consumers"]["points"]) % 4:
        problems.append("consumer points must come in fours.")
    ctx = d["context"]
    for item in ctx.get("congestion", []) + ctx.get("facts", []) + ctx.get("regulation", []):
        if not URL.match(str(item.get("source"))):
            problems.append(f"context item without https source: {item}")
    if problems:
        raise GridCheckError("Grid check failed:\n- " + "\n- ".join(problems))
