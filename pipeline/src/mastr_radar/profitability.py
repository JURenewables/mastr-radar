"""Profitability of awarded projects (contract v1.12, WP95).

auctions/awards.json, auctions/solar_awards.json, auctions/solar.json and
costs/costs.json + config/profitability.yaml → costs/profitability.json.

Part of station 3. For every award with the needed inputs: estimated
investment, revenue, project and equity IRR (nominal, pre-tax) and NPV per kW
("value"). An illustration with stated assumptions, not a valuation.
"""

from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

import yaml

from mastr_radar.config import PIPELINE_ROOT

CONFIG_PATH = PIPELINE_ROOT / "config" / "profitability.yaml"
FILE = "costs/profitability.json"
WIND_FIELDS = [
    "round", "bid_date", "group", "state", "lat", "lon", "model", "mw_turbine", "turbines",
    "hub_m", "rotor_m", "flh", "quality_pct", "ct", "capex", "opex", "revenue",
    "project_irr", "equity_irr", "npv", "project_irr_full", "max_capex",
]  # fmt: skip
SOLAR_FIELDS = [
    "round", "bid_date", "group", "state", "lat", "lon", "mw", "yield", "ct", "capex",
    "revenue", "project_irr", "equity_irr", "npv", "project_irr_low_capex",
    "project_irr_full", "max_capex",
]  # fmt: skip


class ProfitabilityCheckError(Exception):
    """Raised when the profitability file breaks the contract."""


# ---------- finance helpers ----------


def npv(rate: float, cfs: list[float]) -> float:
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(cfs))


def irr(cfs: list[float]) -> float | None:
    """Internal rate of return by bisection; None if there is no sign change."""
    lo, hi = -0.5, 1.0
    f_lo, f_hi = npv(lo, cfs), npv(hi, cfs)
    if f_lo * f_hi > 0:
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        f = npv(mid, cfs)
        if abs(f) < 1e-7:
            break
        if f_lo * f < 0:
            hi = mid
        else:
            lo, f_lo = mid, f
    return round((lo + hi) / 2, 4)


def annuity(principal: float, rate: float, years: int) -> float:
    return principal * rate / (1 - (1 + rate) ** -years) if rate else principal / years


def cashflows(capex: float, net: list[float], a: dict) -> dict:
    """Project and equity cash flows for a per-kW project."""
    project = [-capex, *net]
    debt = a["debt_share"] * capex
    service = annuity(debt, a["debt_rate"], a["debt_years"])
    equity = [-(capex - debt)] + [
        cf - (service if t < a["debt_years"] else 0) for t, cf in enumerate(net)
    ]
    return {
        "project_irr": irr(project),
        "equity_irr": irr(equity),
        "npv": round(npv(a["wacc_nominal"], project)),
        # Highest investment that still earns the WACC over the EEG years.
        "max_capex": round(npv(a["wacc_nominal"], [0.0, *net])),
    }


def _interp(points: dict[int, float], year: int) -> float:
    ys = sorted(points)
    if year <= ys[0]:
        return points[ys[0]]
    if year >= ys[-1]:
        return points[ys[-1]]
    for y0, y1 in zip(ys, ys[1:], strict=False):
        if y0 <= year <= y1:
            return points[y0] + (points[y1] - points[y0]) * (year - y0) / (y1 - y0)
    return points[ys[-1]]


# ---------- wind ----------


def _tail(
    energy: float,
    ct_market: float | None,
    opex_last: float,
    a: dict,
    degr: float = 0.0,
    t0: int = 0,
) -> list[float]:
    """Net cash flows after the EEG years until life_years at the market value."""
    if ct_market is None:
        return []
    return [
        energy * (1 - degr) ** (t0 + i) * ct_market / 100
        - opex_last * (1 + a["opex_inflation"]) ** (i + 1)
        for i in range(a.get("life_years", a["years"]) - a["years"])
    ]


def wind_project(
    aw: dict, a: dict, trend: dict[int, float], ct_market: float | None = None
) -> dict | None:
    b = a["bounds"]
    need = (
        "kw",
        "turbines",
        "hub_height_m",
        "rotor_diameter_m",
        "full_load_hours",
        "received_ct_est",
    )
    if any(aw.get(k) in (None, 0) for k in need):
        return None
    mw = aw["kw"] / aw["turbines"] / 1000
    flh, ct = aw["full_load_hours"], aw["received_ct_est"]
    if not (
        b["mw"][0] <= mw <= b["mw"][1]
        and b["flh"][0] <= flh <= b["flh"][1]
        and b["ct"][0] <= ct <= b["ct"][1]
    ):
        return None
    f = a["hik_formula"]
    sfl = mw * 1e6 / (math.pi * (aw["rotor_diameter_m"] / 2) ** 2)
    hik = f["a"] + f["b"] * mw + f["c"] * sfl + f["d"] * aw["hub_height_m"]
    hik = min(max(hik, a["hik_bounds"][0]), a["hik_bounds"][1])
    year = int(aw["bid_date"][:4])
    hik *= _interp(trend, year) / trend[f["year"]]
    capex = hik + a["ancillary_eur_kw"]
    start = year + 2  # typical start of operation after the award
    rev = flh * ct / 100
    o = a["opex_eur_kw"]
    opex = [
        (o["years_1_10"] if t < 10 else o["years_11_20"])
        * (1 + a["opex_inflation"]) ** (start + t - o["year"])
        for t in range(a["years"])
    ]
    net = [rev - x for x in opex]
    res = cashflows(capex, net, a)
    tail = _tail(flh, ct_market, opex[-1], a)
    full = irr([-capex, *net, *tail]) if tail else None
    return {
        "round": aw["round"],
        "bid_date": aw["bid_date"],
        "group": aw.get("group"),
        "state": aw.get("state"),
        "lat": aw.get("lat"),
        "lon": aw.get("lon"),
        "model": aw.get("model"),
        "mw_turbine": round(mw, 2),
        "turbines": aw["turbines"],
        "hub_m": aw["hub_height_m"],
        "rotor_m": aw["rotor_diameter_m"],
        "flh": flh,
        "quality_pct": aw.get("quality_pct"),
        "ct": ct,
        "capex": round(capex),
        "opex": round(opex[0], 1),
        "revenue": round(rev),
        **res,
        "project_irr_full": full,
    }


# ---------- solar ----------


def solar_project(
    aw: dict, ct: float | None, a: dict, ct_market: float | None = None
) -> dict | None:
    b = a["bounds"]
    y = aw.get("specific_yield_kwh_kwp")
    if aw.get("programme") != "solar" or not y or not ct or not aw.get("kw"):
        return None
    if not (b["yield"][0] <= y <= b["yield"][1] and b["ct"][0] <= ct <= b["ct"][1]):
        return None
    year = int(aw["bid_date"][:4])
    mids = {int(k): v for k, v in a["capex_mid_by_year"].items()}
    capex = _interp(mids, year)
    start = year + 1
    net = []
    for t in range(a["years"]):
        energy = y * (1 - a["degradation"]) ** t
        net.append(
            energy * ct / 100 - a["opex_eur_kwp"] * (1 + a["opex_inflation"]) ** (start + t - 2024)
        )
    res = cashflows(capex, net, a)
    low = cashflows(a["capex_low"], net, a)
    low.pop("max_capex")
    opex_last = a["opex_eur_kwp"] * (1 + a["opex_inflation"]) ** (start + a["years"] - 1 - 2024)
    tail = _tail(y, ct_market, opex_last, a, a["degradation"], a["years"])
    full = irr([-capex, *net, *tail]) if tail else None
    return {
        "round": aw["round"],
        "bid_date": aw["bid_date"],
        "group": aw.get("group"),
        "state": aw.get("state"),
        "lat": aw.get("lat"),
        "lon": aw.get("lon"),
        "mw": round(aw["kw"] / 1000, 2),
        "yield": y,
        "ct": ct,
        "capex": round(capex),
        "revenue": round(y * ct / 100),
        **res,
        "project_irr_low_capex": low["project_irr"],
        "project_irr_full": full,
    }


# ---------- summaries ----------


def _q(vals: list[float]) -> dict | None:
    v = sorted(x for x in vals if x is not None)
    if not v:
        return None
    qs = statistics.quantiles(v, n=4) if len(v) >= 4 else [v[0], statistics.median(v), v[-1]]
    return {
        "p25": round(qs[0], 4),
        "median": round(statistics.median(v), 4),
        "p75": round(qs[2], 4),
        "n": len(v),
    }


def summarise(rows: list[dict], key: str, metrics: list[str]) -> list[dict]:
    groups: dict[str, list[dict]] = {}
    for r in rows:
        if r.get(key):
            groups.setdefault(r[key], []).append(r)
    out = []
    for k, rs in groups.items():
        e = {key: k, "projects": len(rs)}
        if key == "round":
            e["bid_date"] = rs[0]["bid_date"]
        for m in metrics:
            e[m] = _q([r[m] for r in rs])
        out.append(e)
    return sorted(out, key=lambda e: e.get("bid_date") or e[key])


def _compact(rows: list[dict], fields: list[str]) -> dict:
    def val(r, f):
        v = r.get(f)
        return round(v, 2) if f in ("lat", "lon") and v is not None else v

    return {"fields": fields, "rows": [[val(r, f) for f in fields] for r in rows]}


def _sensitivity(rep: dict, a: dict, s: dict, kind: str) -> dict:
    """IRR change for a representative project when one input moves."""

    def run(capex_f=1.0, ct_d=0.0, rate_d=0.0):
        aa = {**a, "debt_rate": a["debt_rate"] + rate_d / 100}
        capex = rep["capex"] * capex_f
        ct = rep["ct"] + ct_d
        if kind == "wind":
            net = []
            o = a["opex_eur_kw"]
            for t in range(a["years"]):
                ox = (o["years_1_10"] if t < 10 else o["years_11_20"]) * (
                    1 + a["opex_inflation"]
                ) ** (2026 + t - o["year"])
                net.append(rep["flh"] * ct / 100 - ox)
        else:
            net = [
                rep["yield"] * (1 - a["degradation"]) ** t * ct / 100
                - a["opex_eur_kwp"] * (1 + a["opex_inflation"]) ** (2026 + t - 2024)
                for t in range(a["years"])
            ]
        return cashflows(capex, net, aa)

    base = run()
    cases = {
        "capex_minus": run(capex_f=1 - s["capex_pct"] / 100),
        "capex_plus": run(capex_f=1 + s["capex_pct"] / 100),
        "price_minus": run(ct_d=-s["price_ct"]),
        "price_plus": run(ct_d=s["price_ct"]),
        "rate_minus": run(rate_d=-s["rate_points"]),
        "rate_plus": run(rate_d=s["rate_points"]),
    }
    return {"representative": rep, "base": base, "cases": cases, "steps": s}


def build(
    out_dir: Path, data_dir: Path | None = None, config_path: Path = CONFIG_PATH
) -> list[dict]:
    cfg = yaml.safe_load(config_path.read_text())
    market = None
    if data_dir and (data_dir / cfg["market_file"]).exists():
        market = json.loads((data_dir / cfg["market_file"]).read_text())
    elif (out_dir / FILE).exists():  # keep the last published market values
        market = json.loads((out_dir / FILE).read_text()).get("market")
    m12 = (market or {}).get("last_12m") or {}
    ct_wind = m12["wind_onshore"] / 10 if "wind_onshore" in m12 else None
    ct_solar = m12["solar"] / 10 if "solar" in m12 else None
    costs = json.loads((out_dir / "costs" / "costs.json").read_text())
    wg = next(s for s in costs["wind_onshore"]["capex_trend"] if s["source"] == "windguard")
    trend = {int(y): v for y, v in wg["points"]}
    trend = {y: _interp(trend, y) for y in range(min(trend), max(trend) + 1)}

    awards = json.loads((out_dir / "auctions" / "awards.json").read_text())["awards"]
    wa = cfg["wind"]
    wind, wind_skipped = [], 0
    for aw in awards:
        p = wind_project(aw, wa, trend, ct_wind)
        if p:
            wind.append(p)
        else:
            wind_skipped += 1

    rounds = json.loads((out_dir / "auctions" / "solar.json").read_text())["rounds"]
    price = {r["id"]: r.get("avg_ct") for r in rounds}
    sa = cfg["solar"]
    solar, solar_skipped = [], 0
    for aw in json.loads((out_dir / "auctions" / "solar_awards.json").read_text())["awards"]:
        p = solar_project(aw, price.get(aw["round"]), sa, ct_solar)
        if p:
            solar.append(p)
        else:
            solar_skipped += int(aw.get("programme") == "solar")

    wm = ["project_irr", "equity_irr", "npv", "capex", "ct", "flh", "project_irr_full", "max_capex"]
    sm = [
        "project_irr",
        "equity_irr",
        "npv",
        "capex",
        "ct",
        "yield",
        "project_irr_full",
        "project_irr_low_capex",
        "max_capex",
    ]
    recent_w = [p for p in wind if p["bid_date"] >= "2025"] or wind
    recent_s = [p for p in solar if p["bid_date"] >= "2025"] or solar
    rep_w = {k: statistics.median(p[k] for p in recent_w) for k in ("capex", "ct", "flh")}
    rep_s = {k: statistics.median(p[k] for p in recent_s) for k in ("capex", "ct", "yield")}
    out = {
        "as_of": costs["as_of"],
        "assumptions": {
            "wind": wa,
            "solar": sa,
            "notes": cfg["notes"],
            "sources": costs["sources"],
        },
        "market": market,
        "wind": {
            "projects": _compact(wind, WIND_FIELDS),
            "skipped": wind_skipped,
            "overall": {m: _q([p[m] for p in wind]) for m in wm},
            "by_round": summarise(wind, "round", wm),
            "by_state": sorted(
                summarise(wind, "state", wm), key=lambda e: -(e["npv"] or {}).get("median", 0)
            ),
            "sensitivity": _sensitivity(rep_w, wa, cfg["sensitivity"], "wind"),
        },
        "solar": {
            "projects": _compact(solar, SOLAR_FIELDS),
            "skipped": solar_skipped,
            "overall": {m: _q([p[m] for p in solar]) for m in sm},
            "by_round": summarise(solar, "round", sm),
            "by_state": sorted(
                summarise(solar, "state", sm), key=lambda e: -(e["npv"] or {}).get("median", 0)
            ),
            "sensitivity": _sensitivity(rep_s, sa, cfg["sensitivity"], "solar"),
        },
    }
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return [{"name": FILE, "rows": len(wind) + len(solar), "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems: list[str] = []
    for tech, need, fields in (("wind", 1000, WIND_FIELDS), ("solar", 500, SOLAR_FIELDS)):
        t = d.get(tech) or {}
        pr = t.get("projects", {})
        if pr.get("fields") != fields:
            problems.append(f"{tech}: project fields differ from the contract.")
            continue
        rows = [dict(zip(fields, r, strict=True)) for r in pr.get("rows", [])]
        if len(rows) < need:
            problems.append(f"{tech}: only {len(rows)} projects (need ≥ {need}).")
        if not rows:
            continue
        unsolved = sum(r["project_irr"] is None for r in rows)
        if unsolved > 0.1 * len(rows):
            problems.append(f"{tech}: project IRR unsolved for {unsolved} of {len(rows)} projects.")
        for r in rows:
            if not 0 < r["capex"] < 3000:
                problems.append(f"{tech} {r['round']}: capex {r['capex']} out of bounds.")
                break
            if r["project_irr"] is not None and not -0.3 < r["project_irr"] < 0.5:
                problems.append(f"{tech} {r['round']}: IRR {r['project_irr']} implausible.")
                break
        med = statistics.median(r["project_irr"] for r in rows if r["project_irr"] is not None)
        if abs(med - t["overall"]["project_irr"]["median"]) > 1e-3:
            problems.append(f"{tech}: overall median IRR does not match the projects.")
        if sum(e["projects"] for e in t["by_round"]) != len(rows):
            problems.append(f"{tech}: by_round does not add up to the projects.")
    if problems:
        raise ProfitabilityCheckError("Profitability check failed:\n- " + "\n- ".join(problems))
