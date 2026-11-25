"""Outlook page (contract v1.9 draft): repowering potential and auction
outlook → outlook/outlook.json (station 3). Reads units.parquet,
unit_details.parquet and the auction files written earlier in station 3."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import yaml

from mastr_radar import auctions as wa
from mastr_radar import monitor
from mastr_radar.config import PIPELINE_ROOT

CONFIG = PIPELINE_ROOT / "config" / "outlook.yaml"
FILE = "outlook/outlook.json"


class OutlookCheckError(Exception):
    """Raised when outlook.json breaks the contract."""


def _mw(kw: float) -> float:
    return round(float(kw) / 1000, 1)


def repowering(extract_dir: Path, as_of: date, cfg: dict, groups_cfg: dict) -> dict:
    cols = [
        "unit_id",
        "technology",
        "status",
        "capacity_kw",
        "commissioning_date",
        "shutdown_date",
        "state",
        "district_key",
        "lat",
        "lon",
        "manufacturer",
        "turbine_model",
        "hub_height_m",
        "rotor_diameter_m",
        "operator_name",
        "operator_is_person",
    ]
    w = pq.read_table(extract_dir / "units.parquet", columns=cols).to_pandas()
    w = w[w["technology"] == "wind_onshore"]
    w["year"] = pd.to_datetime(w["commissioning_date"]).dt.year
    live = w[(w["status"] == "operating") & w["year"].notna()].copy()
    live["age"] = as_of.year - live["year"]
    eeg, nxt = cfg["eeg_years"], cfg["next_wave_years"]
    old = live[live["age"] > eeg]  # support has ended (20 years plus the start year)
    wave = live[(live["age"] >= nxt) & (live["age"] <= eeg)]
    by_district = {}
    for k, g in live.groupby("district_key"):
        o = g[g["age"] > eeg]
        n = g[(g["age"] >= nxt) & (g["age"] <= eeg)]
        if len(o) or len(n):
            by_district[k] = [_mw(o["capacity_kw"].sum()), int(len(o)), _mw(n["capacity_kw"].sum())]
    pts = pd.concat([old.assign(c=1), wave.assign(c=2)]).dropna(subset=["lat", "lon"])
    points = [
        v
        for r in pts.itertuples()
        for v in (round(r.lon * 100), round(r.lat * 100), round(r.capacity_kw / 10), r.c)
    ]
    bcfg = yaml.safe_load(monitor.BRANDS_CONFIG.read_text())
    brand = old["manufacturer"].map(lambda m: monitor.brand_of(m, bcfg))
    family = [
        monitor.model_family(b, m, bcfg) or (m or "")
        for b, m in zip(brand, old["turbine_model"], strict=True)
    ]
    models = (
        old.assign(model=brand + " " + pd.Series(family, index=old.index))
        .groupby("model")
        .agg(
            units=("capacity_kw", "size"),
            mw=("capacity_kw", "sum"),
            hub=("hub_height_m", "median"),
            rotor=("rotor_diameter_m", "median"),
        )
        .sort_values("units", ascending=False)
        .head(12)
    )
    named = old[
        old["operator_name"].notna()
        & ~old["operator_is_person"].fillna(False).astype(bool)
        & (old["capacity_kw"] >= cfg["owner_min_kw"])
    ].copy()
    named["owner"] = [wa.attribute(n, groups_cfg)[0] or n for n in named["operator_name"]]
    owners = (
        named.groupby("owner")["capacity_kw"]
        .agg(["sum", "size"])
        .sort_values("sum", ascending=False)
        .head(15)
    )
    shut = w[(w["status"] == "permanently_shut_down") & w["shutdown_date"].notna()].copy()
    shut["y"] = pd.to_datetime(shut["shutdown_date"]).dt.year
    years = list(range(2015, as_of.year + 1))
    retired = shut.groupby("y")["capacity_kw"].sum()
    added = live.groupby("year")["capacity_kw"].sum()
    recent = live[live["year"] == as_of.year - 1]
    new_mw = float(recent["capacity_kw"].mean() / 1000) if len(recent) else 5.0
    return {
        "eeg_years": eeg,
        "next_wave_years": nxt,
        "old": {
            "units": int(len(old)),
            "mw": _mw(old["capacity_kw"].sum()),
            "avg_mw": round(float(old["capacity_kw"].mean() / 1000), 2),
        },
        "next_wave": {"units": int(len(wave)), "mw": _mw(wave["capacity_kw"].sum())},
        "potential": {
            "replacement_ratio": cfg["replacement_ratio"],
            "new_turbine_mw": round(new_mw, 2),
            "mw": round(len(old) * cfg["replacement_ratio"] * new_mw, 0),
        },
        "by_state_mw": {
            s: _mw(v)
            for s, v in old.groupby("state")["capacity_kw"]
            .sum()
            .sort_values(ascending=False)
            .items()
        },
        "districts": by_district,
        "points": points,
        "models": [
            {
                "model": m.strip(),
                "units": int(r.units),
                "mw": _mw(r.mw),
                "hub_m": None if pd.isna(r.hub) else int(r.hub),
                "rotor_m": None if pd.isna(r.rotor) else int(r.rotor),
            }
            for m, r in models.iterrows()
        ],
        "owners": [
            {"owner": o, "mw": _mw(r["sum"]), "units": int(r["size"])} for o, r in owners.iterrows()
        ],
        "retired_mw_by_year": {str(y): _mw(retired.get(y, 0)) for y in years},
        "added_mw_by_year": {str(y): _mw(added.get(y, 0)) for y in years},
    }


def auction_outlook(
    extract_dir: Path,
    out_dir: Path,
    as_of: date,
    cfg: dict,
    rounds_cfg: list[dict],
    cache_dir: Path | None,
) -> dict:
    det = pq.read_table(
        extract_dir / "unit_details.parquet",
        columns=["unit_id", "technology", "award_no", "permit_date"],
    ).to_pandas()
    units = pq.read_table(
        extract_dir / "units.parquet", columns=["unit_id", "status", "capacity_kw"]
    ).to_pandas()
    d = det[det["technology"] == "wind_onshore"].merge(units, on="unit_id")
    planned = d[(d["status"] == "planned") & d["permit_date"].notna()]
    # Awarded turbines: award number in MaStR, or listed on a BNetzA award list.
    on_lists: set[str] = set()
    if cache_dir is not None:
        eeg = pq.read_table(
            extract_dir / "units.parquet", columns=["unit_id", "eeg_id"]
        ).to_pandas()
        key = dict(zip(eeg["eeg_id"], eeg["unit_id"], strict=True))
        for rnd in rounds_cfg:
            xlsx = cache_dir / f"{rnd['id']}.xlsx"
            if xlsx.exists():
                for a in wa.parse_award_list(xlsx):
                    on_lists |= {key.get(t, t) for t in a["turbines"]}
    is_awarded = planned["award_no"].notna() | planned["unit_id"].isin(on_lists)
    pool = planned[~is_awarded]
    awarded = planned[is_awarded]
    pool_year = (
        pool.assign(y=pd.to_datetime(pool["permit_date"]).dt.year).groupby("y")["capacity_kw"].sum()
    )
    on = json.loads((out_dir / "auctions" / "onshore.json").read_text())
    so = json.loads((out_dir / "auctions" / "solar.json").read_text())
    rounds = [r for r in on["rounds"] if r.get("avg_ct")][-8:]
    srounds = [r for r in so["rounds"] if r.get("programme") == "solar" and r.get("avg_ct")][-6:]
    vol = [
        r["volume_kw"] or r["awarded_kw"]
        for r in rounds[-4:]
        if (r["volume_kw"] or r["awarded_kw"])
    ]
    avg_vol_mw = sum(vol) / len(vol) / 1000 if vol else None

    def next_dates(months: list[int], n: int = 4) -> list[str]:
        out, y = [], as_of.year
        while len(out) < n:
            for mm in months:
                dt = date(y, mm, 1)
                if dt > as_of and len(out) < n:
                    out.append(dt.isoformat())
            y += 1
        return out

    risk_path = out_dir / "auctions" / "market_risk.json"
    market = json.loads(risk_path.read_text()) if risk_path.exists() else {}
    return {
        "wind": {
            "next_bid_dates": next_dates(cfg["wind_bid_months"]),
            "permitted_pool_mw": _mw(pool["capacity_kw"].sum()),
            "permitted_pool_by_permit_year_mw": {
                str(int(y)): _mw(v) for y, v in pool_year.items() if y >= 2018
            },
            "awarded_not_built_mw": _mw(awarded["capacity_kw"].sum()),
            "avg_volume_mw": None if avg_vol_mw is None else round(avg_vol_mw),
            "rounds_covered": None
            if not avg_vol_mw
            else round(float(pool["capacity_kw"].sum()) / 1000 / avg_vol_mw, 1),
            "recent_rounds": [
                {
                    "bid_date": r["bid_date"],
                    "avg_ct": r["avg_ct"],
                    "ceiling_ct": r.get("ceiling_ct"),
                    "volume_mw": round((r["volume_kw"] or r["awarded_kw"] or 0) / 1000),
                }
                for r in rounds
            ],
            "oversubscription": (market.get("wind") or {}).get("market", []),
        },
        "solar": {
            "next_bid_dates": next_dates(cfg["solar_bid_months"]),
            "recent_rounds": [
                {
                    "bid_date": r["bid_date"],
                    "avg_ct": r["avg_ct"],
                    "ceiling_ct": r.get("ceiling_ct"),
                    "volume_mw": round((r.get("volume_kw") or r.get("awarded_kw") or 0) / 1000),
                }
                for r in srounds
            ],
            "oversubscription": (market.get("solar") or {}).get("market", []),
        },
    }


def build(
    extract_dir: Path,
    out_dir: Path,
    as_of: date,
    rounds: list[dict] = (),
    cache_dir: Path | None = None,
) -> list[dict]:
    cfg = yaml.safe_load(CONFIG.read_text())
    groups_cfg = yaml.safe_load(wa.GROUPS_CONFIG.read_text())
    data = {
        "as_of": as_of.isoformat(),
        "repowering": repowering(extract_dir, as_of, cfg["repowering"], groups_cfg),
        "auction_outlook": auction_outlook(
            extract_dir, out_dir, as_of, cfg["auction_outlook"], list(rounds), cache_dir
        ),
    }
    check_data(data)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    return [
        {"name": FILE, "rows": len(data["repowering"]["districts"]), "bytes": path.stat().st_size}
    ]


def check(out_dir: Path) -> None:
    check_data(json.loads((out_dir / FILE).read_text()))


def check_data(d: dict) -> None:
    problems = []
    r = d["repowering"]
    if r["old"]["units"] < 1000:
        problems.append(f"repowering: only {r['old']['units']} turbines past EEG support.")
    if len(r["points"]) % 4:
        problems.append("repowering: points must come in fours.")
    if len(r["districts"]) < 100:
        problems.append("repowering: too few districts.")
    w = d["auction_outlook"]["wind"]
    if len(w["next_bid_dates"]) != 4 or w["next_bid_dates"] != sorted(w["next_bid_dates"]):
        problems.append("auction outlook: next bid dates broken.")
    if w["permitted_pool_mw"] < 0:
        problems.append("auction outlook: negative pool.")
    if problems:
        raise OutlookCheckError("Outlook check failed:\n- " + "\n- ".join(problems))
