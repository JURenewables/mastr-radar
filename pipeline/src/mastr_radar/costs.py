"""Cost benchmarks (contract v1.11, WP90): config/costs.yaml → costs/costs.json.

Part of station 3. The figures come from cited studies (Deutsche WindGuard,
Fraunhofer ISE, Danish Energy Agency, IRENA), not from MaStR. This module
converts them to a common basis for comparison, derives component values,
links them to our auction award prices, and checks the result.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import yaml

from mastr_radar.config import PIPELINE_ROOT

COSTS_PATH = PIPELINE_ROOT / "config" / "costs.yaml"
FILE = "costs/costs.json"
TECHS = ("wind_onshore", "solar")
METHODS = {"table", "text", "chart_read"}
# Plausible bounds per unit family (contract v1.11).
BOUNDS = {"wind_onshore": (500, 3000), "solar": (200, 2500)}


class CostsCheckError(Exception):
    """Raised when the cost benchmarks break the contract."""


def _factor(basis: dict, fx: dict, defl: dict, convert_to: int | None) -> tuple[float, str]:
    """Multiplier from the native price basis to € of the comparison year."""
    cur, year = basis.get("currency"), basis.get("year")
    if cur == "USD":
        rate = fx[year]
        return 1 / rate, f"USD→EUR at {rate} USD per EUR (ECB average {year})"
    if convert_to and year and convert_to != year:
        f = defl[convert_to] / defl[year]
        return f, f"€{year}→€{convert_to} with the DEA price index (×{f:.3f})"
    return 1.0, "none"


def _convert_row(row: dict, fx: dict, defl: dict, flh: float | None = None) -> dict:
    out = dict(row)
    f, how = _factor(row["price_basis"], fx, defl, row.get("convert_to"))
    for k in ("value", "low", "high"):
        if row.get(k) is not None:
            out[f"eur_{k}"] = round(row[k] * f, 1)
    if row.get("variable_eur_mwh") is not None and flh:
        var = row["variable_eur_mwh"] * flh / 1000 * f
        out["eur_value_incl_variable"] = round(out["eur_value"] + var, 1)
        how += f"; variable part at {flh:,.0f} full-load hours"
    out["conversion"] = how
    return out


def _breakdown(b: dict) -> dict:
    out = copy.deepcopy(b)
    groups = out.get("groups") or [out]
    for g in groups:
        total = g["total"]
        for c in g["components"]:
            if "share" in c and "value" not in c:
                c["value"] = round(total * c["share"] / 100)
            elif "value" in c and "share" not in c:
                c["share"] = round(100 * c["value"] / total, 1)
    if "groups" in out:
        out["total"] = sum(g["total"] for g in groups)
    return out


def _award_prices(out_dir: Path, file: str, programme: str | None) -> list[dict]:
    path = out_dir / file
    if not path.exists():
        return []
    rounds = json.loads(path.read_text()).get("rounds", [])
    by_year: dict[int, list[float]] = {}
    for r in rounds:
        if programme and r.get("programme") != programme:
            continue
        if r.get("avg_ct") is None:
            continue
        by_year.setdefault(int(r["bid_date"][:4]), []).append(r["avg_ct"])
    # Simple mean of the round averages (awarded volumes are missing for some rounds).
    return [
        {"year": y, "avg_ct": round(sum(v) / len(v), 2), "rounds": len(v)}
        for y, v in sorted(by_year.items())
    ]


def build(out_dir: Path, costs_path: Path = COSTS_PATH) -> list[dict]:
    raw = yaml.safe_load(costs_path.read_text())
    fx, defl = raw["fx_usd_per_eur"], raw["deflator_dea"]
    out: dict = {
        "as_of": str(raw["as_of"]),
        "sources": raw["sources"],
        "fx_usd_per_eur": fx,
        "deflator_dea": defl,
    }
    links = {
        "wind_onshore": ("auctions/onshore.json", None),
        "solar": ("auctions/solar.json", "solar"),
    }
    for tech in TECHS:
        t = raw[tech]
        flh = t.get("compare_full_load_hours")
        block = {k: v for k, v in t.items() if k not in ("compare_full_load_hours",)}
        block["capex_breakdown"] = _breakdown(t["capex_breakdown"])
        if "capex_breakdown_alt" in t:
            block["capex_breakdown_alt"] = _breakdown(t["capex_breakdown_alt"])
        block["capex_compare"] = [_convert_row(r, fx, defl) for r in t["capex_compare"]]
        block["opex_compare"] = [_convert_row(r, fx, defl, flh) for r in t["opex_compare"]]
        if flh:
            block["compare_full_load_hours"] = flh
        trend = []
        for s in t["capex_trend"]:
            s = dict(s)
            f, how = _factor(s["price_basis"], fx, defl, None)
            if f != 1.0:
                s["eur_points"] = [[y, round(v * f)] for y, v in s.get("points", [])]
                s["conversion"] = how
            trend.append(s)
        block["capex_trend"] = trend
        file, programme = links[tech]
        block["auction_link"] = {"file": file, "years": _award_prices(out_dir, file, programme)}
        out[tech] = block
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    rows = sum(len(out[t]["capex_compare"]) + len(out[t]["opex_compare"]) for t in TECHS)
    return [{"name": FILE, "rows": rows, "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems: list[str] = []
    sources = d.get("sources", {})
    for sid, s in sources.items():
        for k in ("title", "edition", "url", "licence", "attribution"):
            if not s.get(k):
                problems.append(f"source {sid}: missing {k}.")
        if not str(s.get("url", "")).startswith("https://"):
            problems.append(f"source {sid}: url must be https.")

    def src(item: dict, where: str) -> None:
        if item.get("source") not in sources:
            problems.append(f"{where}: unknown source {item.get('source')!r}.")

    def method(item: dict, where: str) -> None:
        m = item.get("method")
        if m not in METHODS:
            problems.append(f"{where}: method must be one of {sorted(METHODS)}.")
        if m == "chart_read" and not item.get("tolerance"):
            problems.append(f"{where}: chart-read values need a tolerance.")

    def basis(item: dict, where: str) -> None:
        b = item.get("price_basis") or {}
        if b.get("currency") not in ("EUR", "USD") or b.get("kind") not in ("nominal", "real"):
            problems.append(f"{where}: needs a price basis with currency and kind.")
        rates = {str(k) for k in d.get("fx_usd_per_eur", {})}  # JSON keys are strings
        if b.get("currency") == "USD" and str(b.get("year")) not in rates:
            problems.append(f"{where}: no exchange rate for {b.get('year')}.")

    def sums(b: dict, where: str) -> None:
        for g in b.get("groups") or [b]:
            comps = g["components"]
            for key in [k for k in ("value", "decade_1", "decade_2") if k in comps[0]]:
                total = g["total"] if key == "value" else b["totals"][key]
                s = sum(c[key] for c in comps)
                tol = max(0.02 * total, 0.5 * len(comps))  # 2 % or the components' rounding
                if abs(s - total) > tol:
                    problems.append(
                        f"{where} {g.get('name', '')}: {key} sums to {s}, total {total}."
                    )
            if all("share" in c for c in comps):
                sh = sum(c["share"] for c in comps)
                if abs(sh - 100) > 1:
                    problems.append(f"{where} {g.get('name', '')}: shares sum to {sh}.")

    for tech in TECHS:
        t = d.get(tech)
        if not t:
            problems.append(f"{tech}: missing.")
            continue
        if t.get("lead") not in sources or not t.get("lead_note"):
            problems.append(f"{tech}: needs a lead source and a lead note.")
        lo, hi = BOUNDS[tech]
        for name in ("capex_breakdown", "capex_breakdown_alt", "opex_breakdown"):
            if name in t:
                b = t[name]
                src(b, f"{tech}.{name}")
                basis(b, f"{tech}.{name}")
                if "groups" in b:
                    for g in b["groups"]:
                        method(g, f"{tech}.{name}.{g['name']}")
                else:
                    method(b, f"{tech}.{name}")
                sums(b, f"{tech}.{name}")
        if not lo <= t["capex_breakdown"]["total"] <= hi:
            problems.append(f"{tech}: capex total outside {lo}–{hi}.")
        for kind in ("capex_compare", "opex_compare"):
            for i, r in enumerate(t.get(kind, [])):
                where = f"{tech}.{kind}[{i}] {r.get('label')}"
                src(r, where)
                method(r, where)
                basis(r, where)
                if not r.get("unit"):
                    problems.append(f"{where}: needs a unit.")
                if r.get("value") is None and (r.get("low") is None or r.get("high") is None):
                    problems.append(f"{where}: needs a value or a low/high range.")
                if r.get("low") is not None and r.get("high") is not None and r["low"] > r["high"]:
                    problems.append(f"{where}: low above high.")
                if "conversion" not in r:
                    problems.append(f"{where}: conversion not stated.")
                vals = [r.get(k) for k in ("eur_value", "eur_low", "eur_high") if r.get(k)]
                if kind == "capex_compare" and any(not lo <= v <= hi for v in vals):
                    problems.append(f"{where}: outside plausible bounds {lo}–{hi}.")
                if kind == "opex_compare" and any(v <= 0 for v in vals):
                    problems.append(f"{where}: opex must be positive.")
        for s in t.get("capex_trend", []):
            where = f"{tech}.capex_trend {s.get('label')}"
            src(s, where)
            method(s, where)
            years = [p[0] for p in s.get("points", s.get("ranges", []))]
            if years != sorted(years) or not years:
                problems.append(f"{where}: years missing or out of order.")
            for r in s.get("ranges", []):
                if r[1] > r[2]:
                    problems.append(f"{where}: range {r} low above high.")
        p = t.get("projections")
        if p:
            src(p, f"{tech}.projections")
            ys = [c[0] for c in p["central"]]
            if ys != sorted(ys):
                problems.append(f"{tech}.projections: years out of order.")
    if problems:
        raise CostsCheckError("Cost benchmarks check failed:\n- " + "\n- ".join(problems))
