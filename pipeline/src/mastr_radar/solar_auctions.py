"""Solar auctions (contract v1.7 draft).

Ground-mounted solar (first segment) and innovation rounds (mostly solar +
storage): prices per round since 2019; award-level analysis where the award
list gives kW (solar since 2023). Awards link to MaStR through the award
number the plant's EEG record carries (and, for innovation rounds, through
register numbers). Writes ``auctions/solar.json`` and ``auctions/solar_awards.json``.
"""

from __future__ import annotations

import json
import math
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import yaml

from mastr_radar import auctions as wa

YIELD_CONFIG = Path(__file__).resolve().parents[2] / "config" / "solar_yield.yaml"
SOURCE = (
    "Bundesnetzagentur, Ausschreibungen Solaranlagen erstes Segment und Innovationsausschreibungen"
)
COLOC_RADIUS_KM = 1.0
COLOC_MIN_STORAGE_KW = 500
TOP = 20


class SolarCheckError(Exception):
    pass


def norm_award(s) -> str | None:
    return re.sub(r"[^A-Z0-9]", "", str(s).upper()) if isinstance(s, str) and s else None


# --- Radiation grid -----------------------------------------------------------


def fetch_radiation(cache_dir: Path) -> int:
    cfg = yaml.safe_load(YIELD_CONFIG.read_text())
    path = cache_dir / cfg["dwd"]["file"]
    if path.exists():
        return 0
    import requests

    r = requests.get(cfg["dwd"]["url"], timeout=300)
    r.raise_for_status()
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return 1


class RadiationGrid:
    def __init__(self, path: Path, crs: str):
        with zipfile.ZipFile(path) as z:
            raw = z.read(next(n for n in z.namelist() if n.endswith(".asc"))).decode("latin-1")
        lines = raw.splitlines()
        hdr, start = {}, 0
        for i, line in enumerate(lines):
            parts = line.split()
            if len(parts) == 2 and parts[0].upper() in (
                "NCOLS",
                "NROWS",
                "XLLCORNER",
                "YLLCORNER",
                "CELLSIZE",
                "NODATA_VALUE",
            ):
                hdr[parts[0].upper()] = float(parts[1])
                start = i + 1
        self.hdr = hdr
        self.grid = np.array(" ".join(lines[start:]).split(), dtype=float).reshape(
            int(hdr["NROWS"]), int(hdr["NCOLS"])
        )
        self.crs = crs

    def sample(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        from pyproj import Transformer

        x, y = Transformer.from_crs("EPSG:4326", self.crs, always_xy=True).transform(lon, lat)
        h = self.hdr
        col = np.floor((np.asarray(x) - h["XLLCORNER"]) / h["CELLSIZE"]).astype(int)
        row = (
            int(h["NROWS"])
            - 1
            - np.floor((np.asarray(y) - h["YLLCORNER"]) / h["CELLSIZE"]).astype(int)
        )
        ok = (col >= 0) & (col < int(h["NCOLS"])) & (row >= 0) & (row < int(h["NROWS"]))
        out = np.full(len(col), np.nan)
        out[ok] = self.grid[row[ok], col[ok]]
        out[out <= 0] = np.nan
        return out


def specific_yield(
    ghi: float, tracker_share: float, east_west_share: float, cfg: dict
) -> float | None:
    if ghi is None or not np.isfinite(ghi):
        return None
    f = cfg["system_factor"]
    fixed = max(0.0, 1 - tracker_share - east_west_share)
    factor = (
        tracker_share * f["tracker"] + east_west_share * f["east_west"] + fixed * f["fixed_south"]
    )
    y = ghi * factor * cfg["performance_ratio"]
    lo, hi = cfg["plausible_specific_yield"]
    return y if lo <= y <= hi else None


# --- Build ----------------------------------------------------------------------


def _centroids(units: pd.DataFrame) -> tuple[dict, dict]:
    """Municipality centre from public unit coordinates, by (municipality, district) and alone."""
    u = units.dropna(subset=["lat", "lon", "municipality"])
    key2 = u.groupby([u["municipality"].str.lower(), u["district"].fillna("").str.lower()])[
        ["lat", "lon"]
    ].mean()
    key1 = u.groupby(u["municipality"].str.lower())[["lat", "lon"]].mean()
    return (
        {k: (r.lat, r.lon) for k, r in key2.iterrows()},
        {k: (r.lat, r.lon) for k, r in key1.iterrows()},
    )


class _StorageIndex:
    """Large batteries for the 'within 1 km' co-location test."""

    def __init__(self, units: pd.DataFrame):
        st = units[
            (units["technology"] == "storage") & (units["capacity_kw"] >= COLOC_MIN_STORAGE_KW)
        ].dropna(subset=["lat", "lon"])
        self.lat, self.lon = st["lat"].to_numpy(), st["lon"].to_numpy()
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, (a, b) in enumerate(
            zip(
                np.floor(self.lat / 0.009).astype(int),
                np.floor(self.lon / 0.0145).astype(int),
                strict=True,
            )
        ):
            self.cells[(a, b)].append(i)

    def near(self, lat: float, lon: float) -> bool:
        a, b = int(math.floor(lat / 0.009)), int(math.floor(lon / 0.0145))
        k = math.cos(math.radians(lat))
        for da in (-1, 0, 1):
            for db in (-1, 0, 1):
                for i in self.cells.get((a + da, b + db), []):
                    if ((self.lat[i] - lat) * 111) ** 2 + (
                        (self.lon[i] - lon) * 111 * k
                    ) ** 2 <= COLOC_RADIUS_KM**2:
                        return True
        return False


def build(
    solar_rounds: list[dict],
    innovation_rounds: list[dict],
    cache_dir: Path,
    units_path: Path,
    out_dir: Path,
) -> list[dict]:
    cfg = yaml.safe_load(wa.GROUPS_CONFIG.read_text())
    reviewed = yaml.safe_load(wa.REVIEWED_CONFIG.read_text()) if wa.REVIEWED_CONFIG.exists() else {}
    ycfg = yaml.safe_load(YIELD_CONFIG.read_text())
    buckets = {g["group"] for g in cfg["groups"] if g.get("bucket")}
    cats = list(cfg["categories"])
    cols = "unit_id eeg_id technology status capacity_kw commissioning_date lat lon"
    cols = (cols + " operator_id municipality district state").split()
    units = pq.read_table(units_path, columns=cols).to_pandas()
    det = pq.read_table(units_path.with_name("unit_details.parquet")).to_pandas()
    det["awn"] = det["award_no"].map(norm_award)
    det = det.merge(units.drop(columns=["technology"]), on="unit_id", how="left")
    by_award = {k: g for k, g in det.dropna(subset=["awn"]).groupby("awn")}
    det_by_unit = det.set_index("unit_id")
    eeg_to_unit = dict(
        zip(units["eeg_id"].dropna(), units.loc[units["eeg_id"].notna(), "unit_id"], strict=True)
    )
    c2, c1 = _centroids(units)
    storage = _StorageIndex(units)
    grid = RadiationGrid(cache_dir.parent / "dwd" / ycfg["dwd"]["file"], ycfg["dwd"]["crs"])
    as_of = wa.monitor_as_of(units_path)

    rows, rounds_out = [], []
    parsed = []
    for prog, rnds in (("solar", solar_rounds), ("innovation", innovation_rounds)):
        for rnd in rnds:
            page = wa.parse_round_page(
                (cache_dir / f"{rnd['id']}.html").read_text(encoding="utf-8")
            )
            xlsx = cache_dir / f"{rnd['id']}.xlsx"
            awards = wa.parse_award_list(xlsx) if xlsx.exists() else []
            parsed.append((prog, rnd, page, awards))

    # Linked MaStR units per award (award number; innovation also register numbers).
    def linked_units(a) -> pd.DataFrame:
        g = by_award.get(norm_award(a["award_no"]))
        ids = set(g["unit_id"]) if g is not None else set()
        for r in a["turbines"]:
            uid = r if r.startswith("SEE") else eeg_to_unit.get(r)
            if uid and uid in det_by_unit.index:
                ids.add(uid)
        return (
            det_by_unit.loc[sorted(ids)].reset_index()
            if ids
            else det_by_unit.iloc[0:0].reset_index()
        )

    # Office attribution needs operator ids per award: reuse the wind rule with a
    # frame indexed by pseudo register ids.
    office_input, linked_ops = [], {}
    for _prog, rnd, page, awards in parsed:
        aw2 = []
        for a in awards:
            lk = linked_units(a)
            pid = [f"{rnd['id']}|{a['award_no']}|{i}" for i in range(len(lk))]
            for p_, op in zip(pid, lk["operator_id"], strict=True):
                linked_ops[p_] = op
            aw2.append({**a, "turbines": pid})
        office_input.append(({"id": rnd["id"]}, page, aw2))
    ops_frame = pd.DataFrame(
        {"operator_id": list(linked_ops.values())}, index=list(linked_ops.keys())
    )
    offices = wa.office_groups(
        office_input, ops_frame, units_path.with_name("operators.parquet"), cfg, reviewed
    )

    for prog, rnd, page, awards in parsed:
        award_level = bool(awards) and all(a["kw"] for a in awards)
        cat_kw: dict[str, float] = defaultdict(float)
        rr = []
        for a in awards if award_level else []:
            rev = wa.reviewed_group(a["bidder"], rnd["id"], a["award_no"], reviewed)
            if rev:
                group, cat, how = rev["group"], wa.category_of(rev["group"], cfg), "reviewed"
            else:
                group, cat = wa.attribute(a["bidder"], cfg)
                how = "name" if group else "none"
                if not group and (rnd["id"], a["award_no"]) in offices:
                    group = offices[(rnd["id"], a["award_no"])][0]
                    cat, how = wa.category_of(group, cfg), "office"
            disp, _ = wa.display_group(group, cat, buckets)
            lk = linked_units(a)
            sol = lk[lk["technology"] == "solar"]
            kw_sol = sol["capacity_kw"].fillna(0)

            def share(mask, kw_sol=kw_sol):
                return float(kw_sol[mask].sum() / kw_sol.sum()) if kw_sol.sum() > 0 else None

            tracker = share(sol["solar_tracker"].fillna(False).astype(bool)) if len(sol) else None
            ew = share(sol["solar_orientation"].fillna("").eq("Ost-West")) if len(sol) else None
            feats = " ".join(sol["solar_features"].dropna())
            special = (
                None
                if not len(sol)
                else bool(re.search(r"Besondere Solaranlage|landwirtschaftlich", feats))
            )
            pts = sol.dropna(subset=["lat", "lon"])
            if len(pts):
                lat, lon, loc = float(pts["lat"].mean()), float(pts["lon"].mean()), "units"
            else:
                m = (a.get("municipality") or "").lower()
                c = c2.get((m, (a.get("district") or "").lower())) or c1.get(m)
                lat, lon, loc = (c[0], c[1], "municipality") if c else (None, None, None)
            coloc = None
            if len(lk):
                coloc = bool(
                    (lk["technology"] == "storage").any()
                    or sol["storage_same_site"].fillna(False).astype(bool).any()
                    or (loc == "units" and storage.near(lat, lon))
                )
            ghi = (
                float(grid.sample(np.array([lon]), np.array([lat]))[0]) if lat is not None else None
            )
            sy = specific_yield(ghi, tracker or 0.0, ew or 0.0, ycfg) if ghi else None
            operating = sol[sol["status"] == "operating"]
            months = [
                (pd.Timestamp(d) - pd.Timestamp(page["bid_date"])).days / 30.44
                for d in operating["commissioning_date"].dropna()
            ]
            volt = sol["grid_voltage"].dropna()
            public = wa.is_legal_entity(a["bidder"], cfg)
            cat_kw[cat] += a["kw"]
            rr.append(
                {
                    "programme": prog,
                    "round": rnd["id"],
                    "bid_date": page["bid_date"],
                    "award_no": a["award_no"],
                    "bidder": a["bidder"] if public else None,
                    "group": group,
                    "rank_group": disp,
                    "category": cat,
                    "attribution": how,
                    "kw": a["kw"],
                    "state": a["state"],
                    "district": a.get("district"),
                    "municipality": a.get("municipality") if public else None,
                    "units_in_mastr": int(len(sol)),
                    "kw_in_mastr": float(kw_sol.sum()),
                    "kw_operating": float(operating["capacity_kw"].fillna(0).sum()),
                    "months_to_operation": round(float(np.median(months)), 1) if months else None,
                    "tracker_share": None if tracker is None else round(tracker, 3),
                    "east_west_share": None if ew is None else round(ew, 3),
                    "special_pv": special,
                    "co_located": coloc,
                    "grid_voltage": volt.mode().iloc[0] if len(volt) else None,
                    "radiation_kwh_m2": None if ghi is None or not np.isfinite(ghi) else round(ghi),
                    "specific_yield_kwh_kwp": None if sy is None else round(sy),
                    "location": loc,
                    "lat": round(lat, 2) if lat is not None and public else None,
                    "lon": round(lon, 2) if lon is not None and public else None,
                }
            )
        rows += rr
        known = [r for r in rr if r["co_located"] is not None]
        kwk = sum(r["kw"] for r in known)
        ys = [r for r in rr if r["specific_yield_kwh_kwp"]]
        rounds_out.append(
            {
                "id": rnd["id"],
                "programme": prog,
                **page,
                "award_level": award_level,
                "list_awards": len(awards),
                "list_kw": float(sum(a["kw"] or 0 for a in awards)),
                "max_award_kw": max((a["kw"] or 0 for a in awards), default=0),
                "kw_by_category": {k: cat_kw.get(k, 0.0) for k in cats} if award_level else None,
                "linked_share": round(
                    sum(r["kw"] for r in rr if r["units_in_mastr"])
                    / max(1, sum(r["kw"] for r in rr)),
                    3,
                )
                if rr
                else None,
                "co_located_share": round(sum(r["kw"] for r in known if r["co_located"]) / kwk, 3)
                if kwk
                else None,
                "co_located_known_kw": kwk,
                "tracker_share": _wshare(rr, "tracker_share"),
                "special_share": _wshare(rr, "special_pv"),
                "specific_yield_avg": round(
                    sum(r["specific_yield_kwh_kwp"] * r["kw"] for r in ys)
                    / sum(r["kw"] for r in ys)
                )
                if ys
                else None,
            }
        )

    df = pd.DataFrame(rows)
    df["year"] = df["bid_date"].str[:4]
    sol = df[df["programme"] == "solar"]
    years = sorted(sol["year"].unique())
    portfolios = _portfolios(sol)
    out = {
        "source": SOURCE,
        "categories": cfg["categories"],
        "rounds": rounds_out,
        "winners_by_year": {
            **{y: _ranking(g, buckets) for y, g in sol.groupby("year")},
            "all": _ranking(sol, buckets),
        },
        "race": _race(sol, years),
        "kw_by_category_year": {
            c: [
                float(sol.loc[(sol["category"] == c) & (sol["year"] == y), "kw"].sum())
                for y in years
            ]
            for c in cats
        },
        "kw_by_state_year": {
            st: [
                float(sol.loc[(sol["state"] == st) & (sol["year"] == y), "kw"].sum()) for y in years
            ]
            for st in sorted(sol["state"].dropna().unique())
        },
        "portfolios": portfolios,
        "dynamics": wa.dynamics(
            sol,
            years,
            [r["id"] for r in rounds_out if r["programme"] == "solar" and r["award_level"]],
            [r["bid_date"] for r in rounds_out if r["programme"] == "solar" and r["award_level"]],
            recent=4,
        ),
        "company_profiles": _profiles(sol, years),
        "points": _points(df, cats),
        "attribution_kw": {
            k: float(sol.loc[sol["attribution"] == k, "kw"].sum())
            for k in ("reviewed", "name", "office", "none")
        },
        "unattributed_share": round(
            float(sol.loc[sol["category"] == "unattributed", "kw"].sum() / sol["kw"].sum()), 4
        ),
        "grid_voltage_kw": {
            v: float(k) for v, k in sol.groupby("grid_voltage")["kw"].sum().items()
        },
        "cross_tech": _cross_tech(sol, out_dir),
        "as_of": as_of.isoformat(),
        "model": {
            "radiation": "DWD 1 km grid, global radiation 1991–2020",
            **{k: ycfg[k] for k in ("performance_ratio", "system_factor")},
        },
    }
    folder = out_dir / "auctions"
    folder.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, data, n in (
        ("solar.json", out, len(rounds_out)),
        ("solar_awards.json", {"source": SOURCE, "awards": rows}, len(rows)),
    ):
        path = folder / name
        text = json.dumps(
            _clean(data),
            separators=(",", ":"),
            ensure_ascii=False,
            default=_json_default,
            allow_nan=False,
        )
        path.write_text(text)
        entries.append({"name": f"auctions/{name}", "rows": n, "bytes": path.stat().st_size})
    return entries


def _clean(o):
    """NaN → null, recursively (JSON has no NaN)."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    raise TypeError(type(o))


def _wshare(rr: list[dict], key: str) -> float | None:
    known = [
        r
        for r in rr
        if r[key] is not None and not (isinstance(r[key], float) and math.isnan(r[key]))
    ]
    kw = sum(r["kw"] for r in known)
    return round(sum(float(r[key]) * r["kw"] for r in known) / kw, 3) if kw else None


def _ranking(g: pd.DataFrame, buckets: set[str]) -> list[dict]:
    total = float(g["kw"].sum()) or 1
    agg = (
        g.groupby("rank_group")
        .agg(
            kw=("kw", "sum"),
            awards=("kw", "size"),
            rounds=("round", "nunique"),
            category=("category", "first"),
        )
        .reset_index()
        .sort_values("kw", ascending=False)
        .head(TOP)
    )
    special = {wa.CITIZEN_ALL, wa.OTHER_MUNICIPAL, wa.NOT_ATTRIBUTED} | buckets
    return [
        {
            "group": r.rank_group,
            "category": r.category,
            "kw": float(r.kw),
            "share": round(float(r.kw) / total, 4),
            "awards": int(r.awards),
            "rounds": int(r.rounds),
            "bucket": r.rank_group in special,
        }
        for r in agg.itertuples()
    ]


def _race(g: pd.DataFrame, years: list[str]) -> dict:
    special = [wa.CITIZEN_ALL, wa.OTHER_MUNICIPAL, wa.NOT_ATTRIBUTED]
    top = (
        g[~g["rank_group"].isin(special)]
        .groupby("rank_group")["kw"]
        .sum()
        .sort_values(ascending=False)
        .head(15)
        .index
    )
    groups = list(top) + [s for s in special if s in set(g["rank_group"])]
    first = g.groupby("rank_group")["category"].first()
    return {
        "years": years,
        "groups": groups,
        "categories": [str(first.get(x, "unattributed")) for x in groups],
        "kw": {
            x: [float(g.loc[(g["rank_group"] == x) & (g["year"] == y), "kw"].sum()) for y in years]
            for x in groups
        },
    }


def _portfolios(sol: pd.DataFrame) -> dict:
    """Several bids by one company (or one bidder name) in the same district and round."""
    s = sol.copy()
    s["owner"] = s["group"].where(
        s["group"].notna() & ~s["rank_group"].isin([wa.CITIZEN_ALL]),
        "bidder: " + s["bidder"].fillna("?"),
    )
    g = s.dropna(subset=["district"]).groupby(["round", "bid_date", "owner", "district"])
    pf = g.agg(
        kw=("kw", "sum"), bids=("kw", "size"), max_bid=("kw", "max"), state=("state", "first")
    ).reset_index()
    multi = pf[pf["bids"] >= 2]
    by_round = []
    for rid, r in s.groupby("round"):
        total = float(r["kw"].sum())
        in_pf = float(multi.loc[multi["round"] == rid, "kw"].sum())
        by_round.append(
            {
                "round": rid,
                "bid_date": r["bid_date"].iloc[0],
                "share_in_portfolios": round(in_pf / total, 3) if total else 0,
            }
        )
    top = multi.sort_values("kw", ascending=False).head(25)
    return {
        "by_round": sorted(by_round, key=lambda x: x["bid_date"]),
        "largest": [
            {
                "owner": o if not o.startswith("bidder: ") else None,
                "round": rid,
                "bid_date": bd,
                "district": d,
                "state": st,
                "bids": int(b),
                "kw": float(k),
                "max_bid_kw": float(mb),
            }
            for rid, bd, o, d, k, b, mb, st in top[
                ["round", "bid_date", "owner", "district", "kw", "bids", "max_bid", "state"]
            ].itertuples(index=False)
        ],
    }


def _profiles(sol: pd.DataFrame, years: list[str]) -> list[dict]:
    named = sol[sol["group"].notna() & (sol["rank_group"] == sol["group"])]
    out = []
    for g, d in named.groupby("group"):
        if d["kw"].sum() < 30_000:
            continue
        known = d[d["co_located"].notna()]
        out.append(
            {
                "group": g,
                "category": d["category"].iloc[0],
                "kw_by_year": [float(d.loc[d["year"] == y, "kw"].sum()) for y in years],
                "awards": int(len(d)),
                "rounds": int(d["round"].nunique()),
                "first_bid": d["bid_date"].min(),
                "median_award_mw": round(float(d["kw"].median()) / 1000, 1),
                "kw_by_state": {
                    k: float(v)
                    for k, v in d.groupby("state")["kw"]
                    .sum()
                    .sort_values(ascending=False)
                    .head(6)
                    .items()
                },
                "states": int(d["state"].nunique()),
                "co_located_share": round(
                    float(
                        known.loc[known["co_located"].astype(bool), "kw"].sum() / known["kw"].sum()
                    ),
                    3,
                )
                if len(known)
                else None,
                "tracker_share": _wshare(d.to_dict("records"), "tracker_share"),
                "specific_yield_avg": round(
                    float(
                        (d["specific_yield_kwh_kwp"] * d["kw"]).sum()
                        / d.loc[d["specific_yield_kwh_kwp"].notna(), "kw"].sum()
                    )
                )
                if d["specific_yield_kwh_kwp"].notna().any()
                else None,
                "attribution_kw": {
                    k: float(d.loc[d["attribution"] == k, "kw"].sum())
                    for k in ("reviewed", "name", "office")
                },
            }
        )
    return sorted(out, key=lambda p: -sum(p["kw_by_year"]))


def _points(df: pd.DataFrame, cats: list[str]) -> dict:
    groups = sorted(df.loc[df["lat"].notna() & df["group"].notna(), "rank_group"].unique())
    gi = {g: i for i, g in enumerate(groups)}
    rounds: dict[str, list[int]] = {}
    for r in df[df["lat"].notna()].itertuples():
        rounds.setdefault(r.round, []).extend(
            [
                int(round(r.lon * 100)),
                int(round(r.lat * 100)),
                int(round(r.kw / 100)),
                cats.index(r.category),
                gi.get(r.rank_group, -1) if isinstance(r.group, str) else -1,
                0 if pd.isna(r.specific_yield_kwh_kwp) else int(r.specific_yield_kwh_kwp),
                -1 if r.co_located is None or pd.isna(r.co_located) else int(bool(r.co_located)),
            ]
        )
    return {"groups": groups, "rounds": rounds}


def _cross_tech(sol: pd.DataFrame, out_dir: Path) -> list[dict]:
    """Company groups active in both onshore wind and solar auctions."""
    path = out_dir / "auctions" / "awards.json"
    if not path.exists():
        return []
    w = pd.DataFrame(json.loads(path.read_text())["awards"])
    w = w[w["group"].notna() & (w["rank_group"] == w["group"])]
    s = sol[sol["group"].notna() & (sol["rank_group"] == sol["group"])]
    out = []
    for g in sorted(set(w["group"]) | set(s["group"])):
        wg, sg = w[w["group"] == g], s[s["group"] == g]
        out.append(
            {
                "group": g,
                "category": (wg["category"].iloc[0] if len(wg) else sg["category"].iloc[0]),
                "wind_kw_since_2023": float(wg.loc[wg["bid_date"] >= "2023", "kw"].sum()),
                "solar_kw_since_2023": float(sg["kw"].sum()),
                "first_wind": wg["bid_date"].min() if len(wg) else None,
                "first_solar": sg["bid_date"].min() if len(sg) else None,
            }
        )
    out = [o for o in out if o["wind_kw_since_2023"] + o["solar_kw_since_2023"] >= 50_000]
    return sorted(out, key=lambda o: -(o["wind_kw_since_2023"] + o["solar_kw_since_2023"]))


def check(out_dir: Path, solar_rounds: list[dict], innovation_rounds: list[dict]) -> None:
    try:
        s = json.loads((out_dir / "auctions" / "solar.json").read_text())
        aw = json.loads((out_dir / "auctions" / "solar_awards.json").read_text())["awards"]
    except (OSError, ValueError, KeyError) as exc:
        raise SolarCheckError(f"solar auction files missing or unreadable: {exc}") from exc
    problems = []
    for name in ("solar.json", "solar_awards.json"):
        if "NaN" in (out_dir / "auctions" / name).read_text():
            problems.append(f"{name}: contains NaN (not valid JSON for browsers).")
    if [r["id"] for r in s["rounds"]] != [r["id"] for r in solar_rounds + innovation_rounds]:
        problems.append("solar.json: rounds differ from settings.")
    for r in s["rounds"]:
        if not r["bid_date"]:
            problems.append(f"{r['id']}: no bid date.")
        prices = [
            r[k] for k in ("min_ct", "avg_ct", "max_ct", "ceiling_ct") if r.get(k) is not None
        ]
        if prices != sorted(prices):
            problems.append(f"{r['id']}: prices out of order.")
        if (
            r["award_level"]
            and r.get("awarded_kw")
            and abs(r["list_kw"] / r["awarded_kw"] - 1) > wa.LIST_TOLERANCE
        ):
            problems.append(
                f"{r['id']}: award list {r['list_kw']:.0f} kW vs page {r['awarded_kw']} kW."
            )
        if r["specific_yield_avg"] is not None and not 850 <= r["specific_yield_avg"] <= 1500:
            problems.append(
                f"{r['id']}: average specific yield {r['specific_yield_avg']} implausible."
            )
    if not any(r["award_level"] for r in s["rounds"] if r["programme"] == "solar"):
        problems.append("solar.json: no solar round with award-level data.")
    if any(a["bidder"] is None and a["lat"] is not None for a in aw):
        problems.append("solar_awards.json: location shown for a bidder without a company name.")
    if problems:
        raise SolarCheckError("; ".join(problems))
