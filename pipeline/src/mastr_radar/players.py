"""Players in the German market, at home and abroad (config/players.yaml) →
auctions/players.json (station 3). Joins each player's German auction and fleet
figures from the auction files already written in this station."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

from mastr_radar.config import PIPELINE_ROOT

PLAYERS_PATH = PIPELINE_ROOT / "config" / "players.yaml"
FILE = "auctions/players.json"
TYPES = {"utility", "municipal", "ipp", "investor", "developer"}
MOMENTUM = {"forward", "steady", "transition", "stuck"}
URL = re.compile(r"^https://\S+$")


class PlayersCheckError(Exception):
    """Raised when players.json breaks the contract."""


def _german(out_dir: Path) -> dict[str, dict]:
    """Per auction group: wind and solar awards (MW), status, German wind fleet (MW)."""
    folder = out_dir / "auctions"
    out: dict[str, dict] = {}

    def put(group: str, **kw) -> None:
        out.setdefault(group, {}).update(kw)

    if (folder / "onshore.json").exists():
        on = json.loads((folder / "onshore.json").read_text())
        for g in on.get("dynamics", {}).get("groups", []):
            put(g["group"], wind_awarded_mw=g["mw"], wind_status=g["status"])
        for g in on["fleet"]["groups"]:
            put(g["group"], wind_fleet_mw=g["mw"])
    if (folder / "solar.json").exists():
        so = json.loads((folder / "solar.json").read_text())
        for g in so.get("dynamics", {}).get("groups", []):
            put(g["group"], solar_awarded_mw=g["mw"], solar_status=g["status"])
    return out


NOT_COMPANIES = {
    "Cooperatives",
    "Citizen wind farms",
    "Partnerships (GbR)",
    "Raiffeisen & farmers",
    "unattributed",
    "Unattributed",
    "Municipal utilities",
    "Other",
}
CHAMPION_WEIGHTS = {"scale": 30, "execution": 20, "breadth": 20, "momentum": 15, "financial": 15}
CHAMPION_LABELS = {
    "scale": "Scale: awarded MW (wind + solar), last 3 years",
    "execution": "Execution: median months from award to operation (faster is better)",
    "breadth": (
        "Breadth: technologies (wind, solar, innovation/solar+storage, "
        "batteries next to wind, hybrid sites)"
    ),
    "momentum": "Momentum: awards in the last 18 months vs the 18 months before",
    "financial": "Financial strength: EBITDA margin (published figures only)",
}


def _months_before(d: str, months: int) -> str:
    y, m = int(d[:4]), int(d[5:7])
    m -= months
    while m <= 0:
        m += 12
        y -= 1
    return f"{y:04d}-{m:02d}-01"


def champions(out_dir: Path, players: list[dict], as_of: str) -> dict:
    """Scores (0–100) per company group active in the German auctions."""
    folder = out_dir / "auctions"
    wind = (
        json.loads((folder / "awards.json").read_text())["awards"]
        if (folder / "awards.json").exists()
        else []
    )
    solar = (
        json.loads((folder / "solar_awards.json").read_text())["awards"]
        if (folder / "solar_awards.json").exists()
        else []
    )
    coloc = (
        json.loads((folder / "colocation.json").read_text())
        if (folder / "colocation.json").exists()
        else {}
    )
    t3y, t18, t36, t30 = (
        _months_before(as_of, 36),
        _months_before(as_of, 18),
        _months_before(as_of, 36),
        _months_before(as_of, 30),
    )
    g: dict[str, dict] = {}
    for a, tech in [(x, "wind") for x in wind] + [(x, x.get("programme", "solar")) for x in solar]:
        grp = a.get("group")
        if not grp or grp in NOT_COMPANIES or "(other)" in grp:
            continue
        e = g.setdefault(
            grp,
            {
                "group": grp,
                "mw_3y": 0.0,
                "mw_recent": 0.0,
                "mw_before": 0.0,
                "old_kw": 0.0,
                "old_op_kw": 0.0,
                "techs": set(),
                "months": [],
                "wind_mw": 0.0,
                "solar_mw": 0.0,
                "innovation_mw": 0.0,
            },
        )
        kw = a.get("kw") or 0
        d = a.get("bid_date") or ""
        e["techs"].add(tech)
        e[f"{tech}_mw" if tech in ("wind", "solar", "innovation") else "solar_mw"] += kw / 1000
        if d >= t3y:
            e["mw_3y"] += kw / 1000
        if d >= t18:
            e["mw_recent"] += kw / 1000
        elif d >= t36:
            e["mw_before"] += kw / 1000
        if d and d < t30:
            e["old_kw"] += kw
            e["old_op_kw"] += min(a.get("kw_operating") or 0, kw)
        if a.get("months_to_operation") is not None:
            e["months"].append(a["months_to_operation"])
    for b in coloc.get("by_group", []):
        if b["group"] in g:
            if b.get("battery_mw"):
                g[b["group"]]["techs"].add("battery")
            if b.get("wind+solar") or b.get("wind+solar+battery"):
                g[b["group"]]["techs"].add("hybrid")
    fin = {}
    for p in players:
        rev, eb = p.get("revenue"), p.get("ebitda")
        if (
            isinstance(rev, (int, float))
            and isinstance(eb, dict)
            and isinstance(eb.get("value"), (int, float))
            and rev > 0
            and "EBITDA" in eb.get("label", "")
        ):
            fin[p.get("group") or p["name"]] = round(eb["value"] / rev, 3)
    flags = {
        (p.get("group") or p["name"]): {"momentum": p["momentum"], "why": p.get("why")}
        for p in players
        if p.get("momentum") in ("stuck", "transition")
    }
    rows = [e for e in g.values() if e["mw_3y"] >= 100 or (e["wind_mw"] + e["solar_mw"]) >= 300]

    def pct(vals: list[float | None]) -> list[float | None]:
        known = sorted(v for v in vals if v is not None)
        if not known:
            return [None] * len(vals)
        return [
            None if v is None else round(100 * (sum(k <= v for k in known) / len(known)))
            for v in vals
        ]

    scale = pct([r["mw_3y"] for r in rows])
    import statistics

    speed = [-statistics.median(r["months"]) if len(r["months"]) >= 3 else None for r in rows]
    execution = pct(speed)
    momentum = pct([(r["mw_recent"] + 1) / (r["mw_before"] + 1) for r in rows])
    financial = pct([fin.get(r["group"]) for r in rows])
    out_rows = []
    for i, r in enumerate(rows):
        sc = {
            "scale": scale[i],
            "execution": execution[i],
            "breadth": round(100 * len(r["techs"]) / 5),
            "momentum": momentum[i],
            "financial": financial[i],
        }
        known = {k: v for k, v in sc.items() if v is not None}
        wsum = sum(CHAMPION_WEIGHTS[k] for k in known)
        total = (
            round(sum(v * CHAMPION_WEIGHTS[k] for k, v in known.items()) / wsum) if wsum else None
        )
        out_rows.append(
            {
                "group": r["group"],
                "scores": sc,
                "total": total,
                "awarded_mw_3y": round(r["mw_3y"]),
                "wind_mw": round(r["wind_mw"]),
                "solar_mw": round(r["solar_mw"]),
                "innovation_mw": round(r["innovation_mw"]),
                "built_share": round(r["old_op_kw"] / r["old_kw"], 3) if r["old_kw"] > 0 else None,
                "median_months_to_operation": round(statistics.median(r["months"]), 1)
                if r["months"]
                else None,
                "momentum_ratio": round((r["mw_recent"] + 1) / (r["mw_before"] + 1), 2),
                "technologies": sorted(r["techs"]),
                "ebitda_margin": fin.get(r["group"]),
                "flag": flags.get(r["group"]),
            }
        )
    out_rows.sort(key=lambda x: -(x["total"] or 0))
    return {
        "weights": CHAMPION_WEIGHTS,
        "labels": CHAMPION_LABELS,
        "method": (
            "Each score is the group's percentile among the groups shown (breadth: "
            "technologies out of five). The total is the weighted mean of the "
            "available scores; financial strength only where an EBITDA figure is "
            "published. Groups with ≥ 100 MW awarded in the last three years or ≥ "
            "300 MW in total; citizen wind farms, partnerships and unattributed "
            "awards left out."
        ),
        "rows": out_rows,
    }


def build(out_dir: Path, path: Path = PLAYERS_PATH) -> list[dict]:
    raw = yaml.safe_load(path.read_text())
    german = _german(out_dir)
    keys = ("wind_awarded_mw", "wind_status", "solar_awarded_mw", "solar_status", "wind_fleet_mw")
    players = []
    for p in raw["players"]:
        g = german.get(p.get("group") or "", {})
        players.append({**p, "germany": {k: g.get(k) for k in keys}})
    out = {
        "as_of": raw["as_of"],
        "players": players,
        "champions": champions(out_dir, players, str(raw["as_of"])),
    }
    check_data(out)
    (out_dir / FILE).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return [{"name": FILE, "rows": len(players), "bytes": (out_dir / FILE).stat().st_size}]


def check(out_dir: Path) -> None:
    check_data(json.loads((out_dir / FILE).read_text()))


def check_data(d: dict) -> None:
    problems = []
    names = set()
    for p in d["players"]:
        w = f"player {p.get('name')!r}"
        if p.get("name") in names:
            problems.append(f"{w}: duplicate.")
        names.add(p.get("name"))
        if p.get("type") not in TYPES:
            problems.append(f"{w}: unknown type {p.get('type')!r}.")
        if p.get("momentum") not in MOMENTUM:
            problems.append(f"{w}: unknown momentum {p.get('momentum')!r}.")
        if not p.get("why"):
            problems.append(f"{w}: momentum needs a reason (why).")
        src = p.get("sources") or []
        if not src or not all(URL.match(str(s)) for s in src):
            problems.append(f"{w}: needs https sources.")
        for k in ("revenue", "ebitda", "net_debt"):
            v = p.get(k)
            ok = (
                v is None
                or v == "not_published"
                or isinstance(v, (int, float))
                or (
                    isinstance(v, dict)
                    and isinstance(v.get("value"), (int, float))
                    and v.get("label")
                )
            )
            if not ok:
                problems.append(
                    f"{w}: {k} must be a number, a {{value, label}} or 'not_published'."
                )
        ni = p.get("net_income")
        if ni is not None and not (
            isinstance(ni, dict) and isinstance(ni.get("value"), (int, float)) and ni.get("label")
        ):
            problems.append(f"{w}: net_income needs value and label.")
        money = [
            k
            for k in ("revenue", "ebitda", "net_debt", "net_income")
            if isinstance(p.get(k), (int, float, dict))
        ]
        if money and not p.get("currency"):
            problems.append(f"{w}: money figures need a currency.")
        emp = p.get("employees")
        if emp and not (isinstance(emp.get("value"), int) and emp["value"] > 0 and emp.get("unit")):
            problems.append(f"{w}: employees need a positive integer and a unit.")
        for k in ("capacity_gw", "renewables_gw", "own_portfolio_gw"):
            v = p.get(k)
            if v is not None and not (isinstance(v, (int, float)) and 0 < v < 500):
                problems.append(f"{w}: {k} out of range.")
    for r in (d.get("champions") or {}).get("rows", []):
        for k, v in r["scores"].items():
            if v is not None and not 0 <= v <= 100:
                problems.append(f"champion {r['group']}: {k} score out of range.")
    if problems:
        raise PlayersCheckError("Players check failed:\n- " + "\n- ".join(problems))
