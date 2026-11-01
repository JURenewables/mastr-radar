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


def build(out_dir: Path, path: Path = PLAYERS_PATH) -> list[dict]:
    raw = yaml.safe_load(path.read_text())
    german = _german(out_dir)
    keys = ("wind_awarded_mw", "wind_status", "solar_awarded_mw", "solar_status", "wind_fleet_mw")
    players = []
    for p in raw["players"]:
        g = german.get(p.get("group") or "", {})
        players.append({**p, "germany": {k: g.get(k) for k in keys}})
    out = {"as_of": raw["as_of"], "players": players}
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
        money = [k for k in ("revenue", "ebitda", "net_debt") if p.get(k) is not None]
        if money and not p.get("currency"):
            problems.append(f"{w}: money figures need a currency.")
        emp = p.get("employees")
        if emp and not (isinstance(emp.get("value"), int) and emp["value"] > 0 and emp.get("unit")):
            problems.append(f"{w}: employees need a positive integer and a unit.")
        for k in ("capacity_gw", "renewables_gw", "own_portfolio_gw"):
            v = p.get(k)
            if v is not None and not (isinstance(v, (int, float)) and 0 < v < 500):
                problems.append(f"{w}: {k} out of range.")
    if problems:
        raise PlayersCheckError("Players check failed:\n- " + "\n- ".join(problems))
