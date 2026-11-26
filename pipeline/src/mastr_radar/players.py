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
CHAMPION_WEIGHTS = {"scale": 35, "execution": 20, "momentum": 15, "breadth": 15, "efficiency": 15}
CHAMPION_LABELS = {
    "scale": "Scale: awarded MW (wind + solar), last 3 years, relative to the leader",
    "execution": "Execution: median months from award to operation (faster is better)",
    "breadth": "Breadth: renewable auctions won (wind, solar, innovation = solar + storage)",
    "momentum": "Momentum: awards in the last 18 months vs the 18 months before",
    "efficiency": (
        "Efficiency: MW on the ground per employee "
        "(company-reported capacity, else awarded MW in operation)"
    ),
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
        e["op_kw"] = e.get("op_kw", 0.0) + min(a.get("kw_operating") or 0, kw)
        if a.get("months_to_operation") is not None:
            e["months"].append(a["months_to_operation"])
    for b in coloc.get("by_group", []):
        if b["group"] in g:
            if b.get("battery_mw"):
                g[b["group"]]["techs"].add("battery")
            if b.get("wind+solar") or b.get("wind+solar+battery"):
                g[b["group"]]["techs"].add("hybrid")
    eff, on_ground = {}, {}
    for p in players:
        emp = (p.get("employees") or {}).get("value")
        key = p.get("group") or p["name"]
        rep = p.get("capacity_gw")
        gw = (rep * 1000) if isinstance(rep, (int, float)) else None
        if gw is None and key in g:
            gw = g[key].get("op_kw", 0) / 1000 or None
        on_ground[key] = gw
        seg = p.get("segment")
        if seg:  # utilities: renewables segment staff and capacity
            eff[key] = round(seg["mw"] / seg["employees"], 2)
        elif emp and gw:
            eff[key] = round(gw / emp, 2)
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

    top_mw = max((r["mw_3y"] for r in rows), default=1) or 1
    scale = [round(100 * r["mw_3y"] / top_mw) for r in rows]
    import statistics

    speed = [-statistics.median(r["months"]) if len(r["months"]) >= 3 else None for r in rows]
    execution = pct(speed)
    momentum = pct([(r["mw_recent"] + 1) / (r["mw_before"] + 1) for r in rows])
    efficiency = pct([eff.get(r["group"]) for r in rows])
    renew = ("wind", "solar", "innovation")
    out_rows = []
    for i, r in enumerate(rows):
        sc = {
            "scale": scale[i],
            "execution": execution[i],
            "momentum": momentum[i],
            "breadth": round(100 * len([t for t in r["techs"] if t in renew]) / 3),
            "efficiency": efficiency[i],
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
                "mw_per_employee": eff.get(r["group"]),
                "operating_mw_from_awards": round(r.get("op_kw", 0) / 1000),
                "flag": flags.get(r["group"]),
            }
        )
    out_rows.sort(key=lambda x: -(x["total"] or 0))
    return {
        "weights": CHAMPION_WEIGHTS,
        "labels": CHAMPION_LABELS,
        "method": (
            "Scale is the group's awarded MW in the last three years relative to the "
            "leader (leader = 100). Execution, momentum and efficiency are "
            "percentiles among the groups shown; breadth counts the renewable "
            "auction types won (out of three). Efficiency only where the company "
            "reports its staff. Corporate financials are not scored: many "
            "developers and IPPs finance projects off balance sheet (project "
            "finance), so EBITDA and debt are not comparable. Batteries and hybrid "
            "sites are shown separately. Groups with ≥ 100 MW awarded in the last "
            "three years or ≥ 300 MW in total; citizen wind farms, partnerships and "
            "unattributed awards left out."
        ),
        "rows": out_rows,
        "segments": segments(players, on_ground, g),
    }


CATEGORY = {
    "developer": "Developer",
    "ipp": "IPP / owner-operator",
    "investor": "Investor",
    "utility": "Utility",
    "municipal": "Utility",
}


def segments(players: list[dict], on_ground: dict, g: dict) -> list[dict]:
    """MW on the ground against employees, with a category per player.

    Utilities that report a renewables segment are placed with that segment's
    staff and capacity (the group total is kept for comparison); others use
    group totals and are marked."""
    out = []
    for p in players:
        emp = (p.get("employees") or {}).get("value")
        key = p.get("group") or p["name"]
        gw = on_ground.get(key)
        reported = isinstance(p.get("capacity_gw"), (int, float))
        if not emp or not gw or (not reported and p["type"] in ("utility", "municipal")):
            continue
        seg = p.get("segment")
        rev = p.get("revenue") if isinstance(p.get("revenue"), (int, float)) else None
        row = {
            "name": p["name"],
            "type": p["type"],
            "employees": seg["employees"] if seg else emp,
            "mw_on_ground": round(seg["mw"] if seg else gw),
            "basis": seg["name"]
            if seg
            else ("company-reported capacity" if reported else "awarded MW in operation"),
            "segment_note": seg.get("mw_note") if seg else None,
            "group_employees": emp,
            "group_mw": round(gw),
            "own_portfolio_mw": round(p["own_portfolio_gw"] * 1000)
            if p.get("own_portfolio_gw")
            else None,
            "awarded_mw_3y": round(g.get(key, {}).get("mw_3y", 0)),
            "revenue_per_employee_k": round(1000 * rev / emp)
            if rev and p.get("currency")
            else None,
            "currency": p.get("currency"),
        }
        row["mw_per_employee"] = round(row["mw_on_ground"] / row["employees"], 2)
        row["group_mw_per_employee"] = round(gw / emp, 2)
        if p["type"] in ("utility", "municipal") and not seg:
            row["basis"] = "group total (no renewables segment reported)"
        out.append(row)  # fmt: skip
    dev = sorted(x["mw_per_employee"] for x in out if x["type"] == "developer")
    med = dev[len(dev) // 2] if dev else 0
    for x in out:
        cat = CATEGORY.get(x["type"], x["type"])
        if x["type"] == "developer":
            cat = "Lean developer" if x["mw_per_employee"] >= med else "Developer (broad services)"
        elif x["type"] in ("utility", "municipal"):
            cat = (
                "Utility, renewables segment"
                if x["basis"] not in ("group total (no renewables segment reported)",)
                else "Utility, group total"
            )
        x["category"] = cat
    return sorted(out, key=lambda x: -x["mw_per_employee"])


def battery_builders(out_dir: Path, players: list[dict], groups: list[str]) -> list[dict]:
    """Who builds batteries (≥ 1 MW, operating and planned), by company name stem."""
    import pyarrow.parquet as pq

    path = out_dir / "units.parquet"
    if not path.exists():
        return []
    t = pq.read_table(
        path,
        columns=[
            "technology",
            "storage_technology",
            "status",
            "capacity_kw",
            "storage_capacity_kwh",
            "operator_name",
        ],
    ).to_pandas()
    t = t[
        (t.technology == "storage")
        & (t.storage_technology == "battery")
        & (t.capacity_kw >= 1000)
        & t.status.isin(["operating", "planned"])
        & t.operator_name.notna()
    ]
    known = sorted(
        {*(p.get("group") or p["name"] for p in players), *groups}, key=len, reverse=True
    )
    generic = {
        "batteriespeicher",
        "bess",
        "energiespeicher",
        "speicher",
        "solarpark",
        "windpark",
        "stadtwerke",
        "battery",
        "energy",
        "energie",
        "power",
        "green",
        "the",
    }

    def stem(name: str) -> str:
        low = name.lower()
        for k in known:
            if len(k) >= 3 and re.search(rf"\b{re.escape(k.lower())}\b", low):
                return k
        legal = {"gmbh", "ag", "se", "kg", "co.", "co", "&", "mbh", "ug", "gmbh&co.kg"}
        words = [x for x in re.findall(r"[\w\-\.&]+", name) if x.lower() not in generic]
        out = []
        for x in words:
            if x.lower().rstrip(".,") in legal or re.fullmatch(r"[\d\-]+", x):
                break
            out.append(x.rstrip(",."))
            if len(out) == 2:
                break
        return " ".join(out) or name

    t["owner"] = t.operator_name.map(stem)
    out = []
    for owner, x in t.groupby("owner"):
        op, pl = x[x.status == "operating"], x[x.status == "planned"]
        out.append({
            "owner": owner,
            "operating_mw": round(op.capacity_kw.sum() / 1000, 1),
            "planned_mw": round(pl.capacity_kw.sum() / 1000, 1),
            "mwh": round(x.storage_capacity_kwh.fillna(0).sum() / 1000, 1),
            "units": int(len(x)),
            "operators": int(x.operator_name.nunique()),
        })  # fmt: skip
    return sorted(out, key=lambda e: -(e["operating_mw"] + e["planned_mw"]))[:25]


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
    groups = [r["group"] for r in out["champions"]["rows"]]
    out["battery_builders"] = battery_builders(out_dir, players, groups)
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
        seg = p.get("segment")
        if seg and not (
            isinstance(seg.get("employees"), int)
            and seg["employees"] > 0
            and isinstance(seg.get("mw"), (int, float))
            and seg.get("name")
        ):
            problems.append(f"{w}: segment needs name, employees and mw.")
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
