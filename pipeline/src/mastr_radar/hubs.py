"""Multi-asset hubs (contract v1.13, WP102): data/extract → hubs/hubs.json.

A hub is a place where at least three asset types come together within
2 km: wind, solar parks (≥ 1 MW, ground-mounted), batteries (≥ 1 MW), gas or
hydrogen power plants (≥ 1 MW), electrolysers, gas storage, large electricity
consumers. Hubs are built around "anchor" assets (everything but wind and
solar); anchors within 1 km of each other form one hub. Locations and names
only for legal entities (D4).
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

FILE = "hubs/hubs.json"
RADIUS_KM = 2.0
MERGE_KM = 1.0
MIN_TYPES = 3
ACTIVE = ("operating", "planned")
TYPES = ["wind", "solar", "battery", "gas_plant", "electrolyser", "gas_storage", "large_consumer"]
ANCHORS = {"battery", "gas_plant", "electrolyser", "gas_storage", "large_consumer"}


class HubsCheckError(Exception):
    """Raised when the hubs file breaks the contract."""


def _km(a_lat, a_lon, b_lat, b_lon) -> float:
    return math.hypot(
        (a_lat - b_lat) * 111.2, (a_lon - b_lon) * 111.2 * math.cos(math.radians(a_lat))
    )


def assets(extract_dir: Path) -> pd.DataFrame:
    """All candidate assets with a type, capacity, status and public location."""
    u = pq.read_table(
        extract_dir / "units.parquet",
        columns=[
            "unit_id",
            "technology",
            "status",
            "capacity_kw",
            "storage_capacity_kwh",
            "lat",
            "lon",
            "state",
            "district",
            "operator_name",
            "operator_is_person",
            "solar_type",
            "name",
        ],
    ).to_pandas()
    u = u[u.status.isin(ACTIVE) & u.lat.notna()]
    wind = u[u.technology == "wind_onshore"].assign(type="wind")
    solar = u[
        (u.technology == "solar") & (u.solar_type == "ground_mounted") & (u.capacity_kw >= 1000)
    ].assign(type="solar")
    bat = u[(u.technology == "storage") & (u.capacity_kw >= 1000)].assign(type="battery")
    parts = [wind, solar, bat]
    other_path = extract_dir / "assets_other.parquet"
    if other_path.exists():
        o = pq.read_table(other_path).to_pandas()
        o = o[o.status.isin(ACTIVE) & o.lat.notna()]
        kind_map = {
            "gas_plant": "gas_plant",
            "hydrogen_plant": "gas_plant",
            "electrolyser": "electrolyser",
            "gas_storage": "gas_storage",
            "large_consumer": "large_consumer",
        }
        o = o[o.kind.isin(kind_map)].assign(
            type=lambda d: d.kind.map(kind_map), technology=lambda d: d.kind
        )
        parts.append(o)
    cols = [
        "unit_id",
        "type",
        "status",
        "capacity_kw",
        "storage_capacity_kwh",
        "lat",
        "lon",
        "state",
        "district",
        "operator_name",
        "operator_is_person",
        "name",
    ]
    return pd.concat([p.reindex(columns=cols) for p in parts], ignore_index=True)


class _Grid:
    def __init__(self, df: pd.DataFrame, cell: float = 0.03):
        self.df = df.reset_index(drop=True)
        self.cell = cell
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, (la, lo) in enumerate(zip(self.df.lat, self.df.lon, strict=True)):
            self.cells[(int(la // cell), int(lo // cell))].append(i)

    def near(self, lat, lon, km) -> list[int]:
        a, b = int(lat // self.cell), int(lon // self.cell)
        out = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in self.cells.get((a + i, b + j), []):
                    if _km(lat, lon, self.df.lat[k], self.df.lon[k]) <= km:
                        out.append(k)
        return out


def build(extract_dir: Path, out_dir: Path, as_of) -> list[dict]:
    a = assets(extract_dir)
    grid = _Grid(a)
    anchors = a[a.type.isin(ANCHORS) & a.operator_is_person.eq(False)].sort_values(
        "capacity_kw", ascending=False
    )
    used: set[int] = set()
    hubs = []
    idx = {uid: i for i, uid in enumerate(grid.df.unit_id)}
    for r in anchors.to_dict("records"):
        i0 = idx[r["unit_id"]]
        if i0 in used:
            continue
        # merge anchors within MERGE_KM into this hub
        group = [k for k in grid.near(r["lat"], r["lon"], MERGE_KM) if grid.df.type[k] in ANCHORS]
        used.update(group)
        lat = float(grid.df.lat[group].mean())
        lon = float(grid.df.lon[group].mean())
        members = grid.df.iloc[grid.near(lat, lon, RADIUS_KM)]
        types = [t for t in TYPES if (members.type == t).any()]
        if len(types) < MIN_TYPES:
            continue
        parts = {}
        for t in types:
            m = members[members.type == t]
            parts[t] = {
                "units": int(len(m)),
                "mw": round(float(m.capacity_kw.fillna(0).sum()) / 1000, 1),
                "planned_units": int((m.status == "planned").sum()),
                **(
                    {"mwh": round(float(m.storage_capacity_kwh.fillna(0).sum()) / 1000, 1)}
                    if t == "battery"
                    else {}
                ),
            }
        legal = members[members.operator_is_person.eq(False) & members.operator_name.notna()]
        ops = [n for n, _ in Counter(legal.operator_name).most_common(5)]
        anchor_names = [str(n) for n in grid.df.name[group].dropna().unique()[:3]]
        hubs.append(
            {
                "hub_id": f"H{len(hubs) + 1:04d}",
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "state": r["state"],
                "district": r["district"],
                "types": types,
                "n_types": len(types),
                "parts": parts,
                "has_planned": any(p["planned_units"] for p in parts.values()),
                "anchors": anchor_names,
                "operators": ops,
            }
        )
    combos = Counter("+".join(h["types"]) for h in hubs)
    type_counts = Counter(t for h in hubs for t in h["types"])
    out = {
        "as_of": str(as_of),
        "rules": {
            "radius_km": RADIUS_KM,
            "merge_km": MERGE_KM,
            "min_types": MIN_TYPES,
            "types": TYPES,
            "thresholds": "solar parks, batteries and gas plants ≥ 1 MW; operating and planned",
        },
        "totals": {
            "hubs": len(hubs),
            "by_n_types": dict(Counter(h["n_types"] for h in hubs)),
            "by_type": dict(type_counts),
        },
        "combinations": [{"types": k.split("+"), "hubs": v} for k, v in combos.most_common(25)],
        "hubs": sorted(
            hubs, key=lambda h: (-h["n_types"], -sum(p["mw"] for p in h["parts"].values()))
        ),
    }
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return [{"name": FILE, "rows": len(hubs), "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems = []
    hubs = d.get("hubs", [])
    if len(hubs) < 20:
        problems.append(f"only {len(hubs)} hubs.")
    for h in hubs:
        if h["n_types"] < d["rules"]["min_types"] or len(h["types"]) != h["n_types"]:
            problems.append(f"{h['hub_id']}: fewer than {d['rules']['min_types']} types.")
            break
        if set(h["parts"]) != set(h["types"]):
            problems.append(f"{h['hub_id']}: parts do not match types.")
            break
    if d.get("totals", {}).get("hubs") != len(hubs):
        problems.append("totals do not match the hubs.")
    if problems:
        raise HubsCheckError("Hubs check failed:\n- " + "\n- ".join(problems))
