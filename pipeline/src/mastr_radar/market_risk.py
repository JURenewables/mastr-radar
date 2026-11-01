"""Overheating and risk view of the auctions → auctions/market_risk.json (station 3).

Reads only station 3 outputs already written (auction files, company facts):
unbuilt award backlog by round, awards past the 36-month wind deadline, and
unbuilt capacity of companies in insolvency or restructuring.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd

FILE = "auctions/market_risk.json"
WIND_DEADLINE_MONTHS = 36  # § 36e EEG 2023
TROUBLE = {"insolvency", "restructuring"}


class RiskCheckError(Exception):
    """Raised when market_risk.json breaks the contract."""


def _rounds(
    rounds: list[dict], awards: pd.DataFrame, as_of: date, deadline: int | None
) -> list[dict]:
    out = []
    for r in rounds:
        a = awards[awards["round"] == r["id"]]
        if a.empty:
            continue
        pub = pd.Timestamp(r.get("published") or r["bid_date"])
        expires = (pub + pd.DateOffset(months=deadline)).date().isoformat() if deadline else None
        kw = float(a["kw"].sum())
        op = float(a["kw_operating"].fillna(0).clip(upper=a["kw"]).sum())
        out.append(
            {
                "id": r["id"],
                "programme": r.get("programme", "wind"),
                "bid_date": r["bid_date"],
                "published": r.get("published"),
                "ceiling_ct": r.get("ceiling_ct"),
                "avg_ct": r.get("avg_ct"),
                "awarded_kw": round(kw),
                "operating_kw": round(op),
                "unbuilt_kw": round(kw - op),
                "expires": expires,
                "past_deadline": bool(expires and expires < as_of.isoformat()),
            }
        )
    return out


def _tech(rounds, awards, facts, as_of, deadline, tech) -> dict:
    rr = _rounds(rounds, awards, as_of, deadline)
    open_rounds = [r for r in rr if not r["past_deadline"]]
    soon = (pd.Timestamp(as_of) + pd.DateOffset(months=12)).date().isoformat()
    awards = awards.assign(
        unbuilt=awards["kw"] - awards["kw_operating"].fillna(0).clip(upper=awards["kw"])
    )
    exposure = []
    for e in facts.get("events", []):
        if e["kind"] not in TROUBLE or not e.get("group") or e["tech"] not in (tech, "both"):
            continue
        g = awards[awards["group"] == e["group"]]
        if g.empty:
            continue
        exposure.append(
            {
                "company": e["company"],
                "group": e["group"],
                "kind": e["kind"],
                "date": e["date"],
                "awarded_kw": round(float(g["kw"].sum())),
                "unbuilt_kw": round(float(g["unbuilt"].sum())),
                "awards_unbuilt": int((g["unbuilt"] > 0).sum()),
            }
        )
    main = "solar" if tech == "solar" else "wind"
    priced = [r for r in rr if r["avg_ct"] and r["programme"] == main]
    peak = max(priced[-12:], key=lambda r: r["avg_ct"]) if priced else None
    last = priced[-1] if priced else None
    return {
        "deadline_months": deadline,
        "rounds": rr,
        "unbuilt_kw": sum(r["unbuilt_kw"] for r in open_rounds),
        "unbuilt_expiring_12m_kw": sum(
            r["unbuilt_kw"] for r in open_rounds if r["expires"] and r["expires"] <= soon
        ),
        "past_deadline_unbuilt_kw": sum(r["unbuilt_kw"] for r in rr if r["past_deadline"]),
        "price_peak": {"bid_date": peak["bid_date"], "avg_ct": peak["avg_ct"]} if peak else None,
        "price_last": {"bid_date": last["bid_date"], "avg_ct": last["avg_ct"]} if last else None,
        "exposure": sorted(exposure, key=lambda x: -x["unbuilt_kw"]),
        "market": [
            o for o in (facts.get("market") or {}).get("oversubscription", []) if o["tech"] == tech
        ],
        "facts": [
            f for f in (facts.get("market") or {}).get("facts", []) if f["tech"] in (tech, "both")
        ],
    }


def build(out_dir: Path, as_of: date) -> list[dict]:
    folder = out_dir / "auctions"
    facts = json.loads((folder / "company_facts.json").read_text())
    out: dict = {"as_of": as_of.isoformat()}
    if (folder / "awards.json").exists():
        on = json.loads((folder / "onshore.json").read_text())
        aw = pd.DataFrame(json.loads((folder / "awards.json").read_text())["awards"])
        out["wind"] = _tech(on["rounds"], aw, facts, as_of, WIND_DEADLINE_MONTHS, "wind")
    if (folder / "solar_awards.json").exists():
        so = json.loads((folder / "solar.json").read_text())
        sa = pd.DataFrame(json.loads((folder / "solar_awards.json").read_text())["awards"])
        rounds = sorted((r for r in so["rounds"] if r["award_level"]), key=lambda r: r["bid_date"])
        out["solar"] = _tech(rounds, sa, facts, as_of, None, "solar")
    check_data(out)
    (out_dir / FILE).write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    )
    rows = sum(len(out[t]["rounds"]) for t in ("wind", "solar") if t in out)
    return [{"name": FILE, "rows": rows, "bytes": (out_dir / FILE).stat().st_size}]


def check(out_dir: Path) -> None:
    check_data(json.loads((out_dir / FILE).read_text()))


def check_data(d: dict) -> None:
    problems = []
    for t in ("wind", "solar"):
        if t not in d:
            continue
        for r in d[t]["rounds"]:
            if not 0 <= r["operating_kw"] <= r["awarded_kw"]:
                problems.append(f"{t} {r['id']}: operating kW outside 0..awarded.")
            if r["unbuilt_kw"] != r["awarded_kw"] - r["operating_kw"]:
                problems.append(f"{t} {r['id']}: unbuilt ≠ awarded − operating.")
        if d[t]["unbuilt_kw"] < 0:
            problems.append(f"{t}: negative backlog.")
        for e in d[t]["exposure"]:
            if not 0 <= e["unbuilt_kw"] <= e["awarded_kw"]:
                problems.append(f"{t} exposure {e['company']}: unbuilt outside 0..awarded.")
    if problems:
        raise RiskCheckError("Market risk check failed:\n- " + "\n- ".join(problems))
