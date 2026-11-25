"""Wind with batteries or solar (contract v1.12, WP96): data/extract →
auctions/colocation.json.

Part of station 3. Two levels:
- same_location: onshore wind and storage or solar registered at the same
  grid connection location in MaStR (LokationMaStRNummer), confirmed;
- nearby: a battery or a ground-mounted solar park of at least 1 MW within
  500 m of an operating or planned wind turbine, likely sharing the site.
Locations and operator names only for legal entities (D4, D13).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

FILE = "auctions/colocation.json"
ACTIVE = ("operating", "planned")
NEAR_KM = 0.5
WIND_KM = 1.0
MIN_KW = 1000


class ColocationCheckError(Exception):
    """Raised when the co-location file breaks the contract."""


def _km(lat1, lon1, lat2, lon2) -> float:
    return math.hypot((lat1 - lat2) * 111.2, (lon1 - lon2) * 111.2 * math.cos(math.radians(lat1)))


class _Grid:
    """Simple spatial hash for 'turbines within x km'."""

    def __init__(self, df: pd.DataFrame, cell: float = 0.02):
        self.cell = cell
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.df = df.reset_index(drop=True)
        for i, (la, lo) in enumerate(zip(self.df.lat, self.df.lon, strict=True)):
            self.cells[(int(la // cell), int(lo // cell))].append(i)

    def near(self, lat: float, lon: float, km: float) -> list[tuple[int, float]]:
        a, b = int(lat // self.cell), int(lon // self.cell)
        out = []
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for k in self.cells.get((a + i, b + j), []):
                    d = _km(lat, lon, self.df.lat[k], self.df.lon[k])
                    if d <= km:
                        out.append((k, d))
        return out


def _status(units: pd.DataFrame) -> str:
    st = set(units.status)
    return st.pop() if len(st) == 1 else "mixed"


def _mwh(kind: str, kwh) -> float | None:
    if kind != "storage":
        return None
    total = float(pd.Series(kwh).fillna(0).sum())
    return round(total / 1000, 2)


def _year(r) -> int | None:
    d = (
        r.get("commissioning_date")
        if r.get("status") == "operating"
        else r.get("planned_commissioning_date")
    )
    return int(str(d)[:4]) if d is not None and not pd.isna(d) else None


def build(extract_dir: Path, out_dir: Path, as_of) -> list[dict]:
    cols = [
        "unit_id", "technology", "status", "capacity_kw", "lat", "lon", "state", "district",
        "operator_name", "operator_is_person", "storage_capacity_kwh", "solar_type",
        "commissioning_date", "planned_commissioning_date",
    ]  # fmt: skip
    u = pq.read_table(extract_dir / "units.parquet", columns=cols).to_pandas()
    u = u[u.status.isin(ACTIVE)]
    det = pq.read_table(
        extract_dir / "unit_details.parquet", columns=["unit_id", "location_id", "award_no"]
    ).to_pandas()
    u = u.merge(det, on="unit_id", how="left")
    awards = {}
    awards_path = out_dir / "auctions" / "awards.json"
    if awards_path.exists():
        for a in json.loads(awards_path.read_text())["awards"]:
            awards[str(a.get("award_no"))] = a["bid_date"]

    def public(r) -> bool:
        return r.get("operator_is_person") is False or r.get("operator_is_person") == 0

    sites: list[dict] = []
    # 1) same grid connection location
    seen: set[str] = set()
    for _loc, g in u[u.location_id.notna()].groupby("location_id"):
        techs = set(g.technology)
        if "wind_onshore" not in techs or not techs & {"storage", "solar"}:
            continue
        w = g[g.technology == "wind_onshore"]
        for kind in ("storage", "solar"):
            p = g[g.technology == kind]
            if p.empty:
                continue
            seen.update(p.unit_id)
            pts = g[g.lat.notna() & g.operator_is_person.eq(False)]
            rounds = sorted({awards.get(str(x)) for x in w.award_no.dropna()} - {None})
            sites.append({
                "tier": "same_location",
                "kind": kind,
                "partner_mw": round(p.capacity_kw.sum() / 1000, 2),
                "partner_mwh": _mwh(kind, p.storage_capacity_kwh),
                "partner_status": _status(p),
                "partner_year": max(
                    (y for y in (_year(r) for r in p.to_dict("records")) if y), default=None
                ),
                "wind_mw": round(w.capacity_kw.sum() / 1000, 2),
                "wind_units": len(w),
                "wind_status": _status(w),
                "award_rounds": rounds,
                "distance_km": 0.0,
                "state": g.state.mode().iat[0] if g.state.notna().any() else None,
                "district": g.district.mode().iat[0] if g.district.notna().any() else None,
                "lat": round(float(pts.lat.mean()), 3) if len(pts) else None,
                "lon": round(float(pts.lon.mean()), 3) if len(pts) else None,
                "operator": None,
            })  # fmt: skip

    # 2) nearby (≤ 500 m), partner ≥ 1 MW, not already matched by location
    wind = u[(u.technology == "wind_onshore") & u.lat.notna()]
    grid = _Grid(wind)
    partners = u[
        u.technology.isin(["storage", "solar"])
        & (u.capacity_kw >= MIN_KW)
        & u.lat.notna()
        & ~u.unit_id.isin(seen)
        & ((u.technology == "storage") | (u.solar_type == "ground_mounted"))
    ]
    for r in partners.to_dict("records"):
        near = grid.near(r["lat"], r["lon"], WIND_KM)
        if not near or min(d for _, d in near) > NEAR_KM:
            continue
        ww = grid.df.iloc[[k for k, _ in near]]
        rounds = sorted({awards.get(str(x)) for x in ww.award_no.dropna()} - {None})
        ok = public(r)
        sites.append({
            "tier": "nearby",
            "kind": r["technology"],
            "partner_mw": round(r["capacity_kw"] / 1000, 2),
            "partner_mwh": _mwh(r["technology"], [r["storage_capacity_kwh"]]),
            "partner_status": r["status"],
            "partner_year": _year(r),
            "wind_mw": round(ww.capacity_kw.sum() / 1000, 2),
            "wind_units": len(ww),
            "wind_status": _status(ww),
            "award_rounds": rounds,
            "distance_km": round(min(d for _, d in near), 2),
            "state": r["state"],
            "district": r["district"],
            "lat": round(r["lat"], 3) if ok else None,
            "lon": round(r["lon"], 3) if ok else None,
            "operator": r["operator_name"] if ok else None,
        })  # fmt: skip

    totals = []
    by_year: dict[tuple, dict] = {}
    for key in sorted({(s["tier"], s["kind"], s["partner_status"]) for s in sites}):
        ss = [s for s in sites if (s["tier"], s["kind"], s["partner_status"]) == key]
        mwh = round(sum(s["partner_mwh"] or 0 for s in ss), 1)
        totals.append({
            "tier": key[0], "kind": key[1], "status": key[2], "sites": len(ss),
            "partner_mw": round(sum(s["partner_mw"] for s in ss), 1),
            "partner_mwh": mwh if key[1] == "storage" else None,
            "wind_mw": round(sum(s["wind_mw"] for s in ss), 1),
            "with_award": sum(bool(s["award_rounds"]) for s in ss),
        })  # fmt: skip
    for s in sites:
        if s["partner_year"]:
            k = (s["kind"], s["partner_year"])
            e = by_year.setdefault(
                k, {"kind": s["kind"], "year": s["partner_year"], "sites": 0, "partner_mw": 0.0}
            )
            e["sites"] += 1
            e["partner_mw"] = round(e["partner_mw"] + s["partner_mw"], 2)
    out = {
        "as_of": str(as_of),
        "rules": {
            "near_km": NEAR_KM,
            "wind_km": WIND_KM,
            "min_partner_kw": MIN_KW,
            "statuses": list(ACTIVE),
        },
        "totals": totals,
        "by_year": sorted(by_year.values(), key=lambda e: (e["kind"], e["year"])),
        "sites": sorted(sites, key=lambda s: -s["partner_mw"]),
    }
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return [{"name": FILE, "rows": len(sites), "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems = []
    sites = d.get("sites", [])
    for s in sites:
        if s["wind_units"] < 1 or s["partner_mw"] <= 0:
            problems.append(f"site without wind or partner: {s}.")
            break
        if s["tier"] == "nearby" and s["distance_km"] > d["rules"]["near_km"]:
            problems.append("nearby site beyond the distance rule.")
            break
        if s["lat"] is None and s["operator"]:
            problems.append("operator shown for a site without public location.")
            break
    if sum(t["sites"] for t in d.get("totals", [])) != len(sites):
        problems.append("totals do not add up to the sites.")
    if problems:
        raise ColocationCheckError("Co-location check failed:\n- " + "\n- ".join(problems))
