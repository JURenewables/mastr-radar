"""Onshore wind auctions (contract v1.5 draft).

A1 fetch: the BNetzA page of each finished onshore round (prices, volumes) and
its award list (.xlsx) into ``data/auctions/``.
A2 build (part of station 3): rounds, winners by company group and the
turbines behind each award (linked to MaStR via the register numbers) →
``auctions/onshore.json`` and ``auctions/awards.json``.

German source names (sheet and column titles, page wording) live only here.
"""

from __future__ import annotations

import html
import json
import re
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
import requests
import yaml

from mastr_radar import monitor

BASE = "https://www.bundesnetzagentur.de"
ROUND_PAGE = (
    BASE + "/DE/Fachthemen/ElektrizitaetundGas/Ausschreibungen/Wind_Onshore/"
    "BeendeteAusschreibungen/{year}/{id}/start.html"
)
GROUPS_CONFIG = Path(__file__).resolve().parents[2] / "config" / "auction_groups.yaml"
MONTHS = {
    m: i + 1
    for i, m in enumerate(
        [
            "Januar",
            "Februar",
            "März",
            "April",
            "Mai",
            "Juni",
            "Juli",
            "August",
            "September",
            "Oktober",
            "November",
            "Dezember",
        ]
    )
}
SOURCE = "Bundesnetzagentur, Ausschreibungen Wind an Land (www.bundesnetzagentur.de)"
LIST_TOLERANCE = 0.10  # award list may include late awards (court rulings): ±10 % of the page
MIN_LINKED = 0.90
TOP_WINNERS = 15


class AuctionCheckError(Exception):
    pass


# --- A1 fetch ---------------------------------------------------------------


def _get(url: str, tries: int = 4) -> requests.Response:
    for i in range(tries):
        try:
            r = requests.get(url, timeout=60, headers={"User-Agent": "mastr-radar"})
            r.raise_for_status()
            return r
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))
    raise AssertionError("unreachable")


def fetch(rounds: list[dict], cache_dir: Path) -> int:
    """Download round pages and award lists that are not cached yet. Returns new files."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    new = 0
    for rnd in rounds:
        page = cache_dir / f"{rnd['id']}.html"
        if not page.exists() or "Zuschlagswert" not in page.read_text(encoding="utf-8"):
            page.write_text(_get(ROUND_PAGE.format(**rnd)).text, encoding="utf-8")
            new += 1
        xlsx = cache_dir / f"{rnd['id']}.xlsx"
        if not xlsx.exists():
            link = re.search(
                r'href="([^"]+Zuschlagslisten/[^"]+\.xlsx)[^"]*"', page.read_text("utf-8")
            )
            if not link:
                raise AuctionCheckError(f"{rnd['id']}: no award list linked on the round page.")
            xlsx.write_bytes(_get(BASE + html.unescape(link.group(1))).content)
            new += 1
    return new


# --- Parsing ----------------------------------------------------------------


def _num(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _date(s: str) -> str:
    d, m, y = re.match(r"(\d+)\. (\w+) (\d{4})", s).groups()
    return date(int(y), MONTHS[m], int(d)).isoformat()


def parse_round_page(text: str) -> dict:
    """Published results of one round from its BNetzA page."""
    t = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", text)
    t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))

    def find(pattern: str) -> str | None:
        m = re.search(pattern, t)
        return m.group(1) if m else None

    fields = {
        "bid_date": find(r"Gebotstermin ist der (\d+\. \w+ \d{4})"),
        "published": find(r"Veröffentlichung am (\d+\. \w+ \d{4})"),
        "ceiling_ct": find(r"Höchstwert für diesen Gebotstermin beträgt (\d+,\d+)"),
        "volume_kw": find(r"Ausschreibungsvolumen beträgt ([\d.]+)"),
        "min_ct": find(r"niedrigste Gebotswert.*?beträgt (\d+,\d+) ct/kWh"),
        "max_ct": find(r"höchste Gebotswert.*?beträgt (\d+,\d+) ct/kWh"),
        "avg_ct": find(r"Zuschlagswert beträgt (\d+,\d+) ct/kWh"),
        "awards": find(r"Es wurden ([\d.]+) Gebote mit einem Gebotsvolumen"),
        "awarded_kw": find(r"Gebotsvolumen von ([\d.]+) kW bezuschlagt"),
    }
    out: dict = {}
    for k, v in fields.items():
        if v is None:
            out[k] = None
        elif k in ("bid_date", "published"):
            out[k] = _date(v)
        elif k in ("volume_kw", "awards", "awarded_kw"):
            out[k] = int(_num(v))
        else:
            out[k] = _num(v)
    return out


def parse_award_list(path: Path) -> list[dict]:
    """One dict per award: bidder, award number, kW, state, turbine register numbers."""
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True)
    awards: dict[str, dict] = {}
    compact = wb["Zuschläge_Kompakt"]
    header = None
    for row in compact.iter_rows(values_only=True):
        if header is None:
            if row and row[0] == "Name des Bieters":
                header = [str(c) for c in row]
            continue
        if not row[0] or not isinstance(row[3], int | float):
            continue
        awards[row[2]] = {
            "bidder": str(row[0]).strip(),
            "award_no": row[2],
            "kw": float(row[3]),
            "state": None,
            "turbines": [],
        }
    if header is None:
        raise AuctionCheckError(f"{path.name}: compact sheet has no header row.")
    header = None
    for row in wb["Zuschläge_Detailliert"].iter_rows(values_only=True):
        if header is None:
            if row and row[0] == "Name des Bieters":
                header = list(row)
                i_award, i_state = header.index("Zuschlags-Nr"), header.index("Bundesland")
                i_reg = header.index("Registernummer")
            continue
        a = awards.get(row[i_award])
        if a is None:
            continue
        a["state"] = a["state"] or row[i_state]
        if row[i_reg] and row[i_reg] not in a["turbines"]:
            a["turbines"].append(str(row[i_reg]).strip())
    return list(awards.values())


def attribute(bidder: str, cfg: dict) -> tuple[str | None, str]:
    """(group, category) of a bidder; (None, 'unattributed') if the name tells nothing."""
    name = bidder.lower()
    for g in cfg["groups"]:
        if re.search(g["match"], name):
            return g["group"], g["category"]
    return None, "unattributed"


def is_legal_entity(bidder: str, cfg: dict) -> bool:
    return re.search(cfg["legal_entity"], bidder.lower()) is not None


# --- A2 build ---------------------------------------------------------------


def _load_turbines(units_path: Path) -> tuple[dict, dict]:
    cols = ["unit_id", "eeg_id", "technology", "status", "manufacturer", "turbine_model",
            "capacity_kw", "commissioning_date"]  # fmt: skip
    df = pq.read_table(units_path, columns=cols).to_pandas()
    df = df[df["technology"] == "wind_onshore"]
    by_unit = df.set_index("unit_id").to_dict("index")
    by_eeg = df.dropna(subset=["eeg_id"]).drop_duplicates("eeg_id").set_index("eeg_id")
    return by_unit, by_eeg.to_dict("index")


def build(rounds: list[dict], cache_dir: Path, units_path: Path, out_dir: Path) -> list[dict]:
    """Write auctions/onshore.json and auctions/awards.json. Returns manifest entries."""
    cfg = yaml.safe_load(GROUPS_CONFIG.read_text())
    brands_cfg = yaml.safe_load(monitor.BRANDS_CONFIG.read_text())
    by_unit, by_eeg = _load_turbines(units_path)

    rows, round_out = [], []
    for rnd in rounds:
        page = parse_round_page((cache_dir / f"{rnd['id']}.html").read_text(encoding="utf-8"))
        awards = parse_award_list(cache_dir / f"{rnd['id']}.xlsx")
        cats: dict[str, float] = defaultdict(float)
        makers: dict[str, float] = defaultdict(float)
        n_turb = n_linked = n_online = 0
        for a in awards:
            group, cat = attribute(a["bidder"], cfg)
            cats[cat] += a["kw"]
            linked = [by_unit.get(r) or by_eeg.get(r) for r in a["turbines"]]
            linked = [u for u in linked if u]
            n_turb += len(a["turbines"])
            n_linked += len(linked)
            n_online += sum(u["status"] == "operating" for u in linked)
            brands = [monitor.brand_of(u["manufacturer"], brands_cfg) for u in linked]
            for u, b in zip(linked, brands, strict=True):
                makers[b] += u["capacity_kw"] or 0
            models = [
                monitor.model_family(b, u["turbine_model"], brands_cfg)
                for u, b in zip(linked, brands, strict=True)
            ]
            top_brand = max(set(brands), key=brands.count) if brands else None
            known = [m for m in models if m]
            rows.append(
                {
                    "round": rnd["id"],
                    "bid_date": page["bid_date"],
                    "award_no": a["award_no"],
                    # Names of possible natural persons are never published (D4).
                    "bidder": a["bidder"] if is_legal_entity(a["bidder"], cfg) else None,
                    "group": group,
                    "category": cat,
                    "kw": a["kw"],
                    "state": a["state"],
                    "turbines": len(a["turbines"]),
                    "turbines_in_mastr": len(linked),
                    "turbines_operating": sum(u["status"] == "operating" for u in linked),
                    "maker": top_brand,
                    "model": max(set(known), key=known.count) if known else None,
                }
            )
        round_out.append(
            {
                "id": rnd["id"],
                **page,
                "list_kw": sum(a["kw"] for a in awards),
                "list_awards": len(awards),
                "kw_by_category": {k: cats.get(k, 0.0) for k in cfg["categories"]},
                "kw_by_maker": dict(sorted(makers.items(), key=lambda kv: -kv[1])),
                "turbines": n_turb,
                "turbines_in_mastr": n_linked,
                "turbines_operating": n_online,
            }
        )

    winners: dict[str, list[dict]] = {}
    df = pd.DataFrame(rows)
    df["year"] = df["bid_date"].str[:4]
    buckets = {g["group"] for g in cfg["groups"] if g.get("bucket")}
    ranked = df[df["group"].notna() & ~df["group"].isin(buckets)]
    for year, g in ranked.groupby("year"):
        agg = (
            g.groupby(["group", "category"])
            .agg(kw=("kw", "sum"), awards=("kw", "size"), rounds=("round", "nunique"))
            .reset_index()
            .sort_values("kw", ascending=False)
            .head(TOP_WINNERS)
        )
        total = float(df.loc[df["year"] == year, "kw"].sum())
        winners[year] = [
            {
                "group": r.group,
                "category": r.category,
                "kw": float(r.kw),
                "share": round(float(r.kw) / total, 4),
                "awards": int(r.awards),
                "rounds": int(r.rounds),
            }
            for r in agg.itertuples()
        ]

    onshore = {
        "source": SOURCE,
        "categories": cfg["categories"],
        "rounds": round_out,
        "winners_by_year": winners,
        "unattributed_share": round(
            float(df.loc[df["category"] == "unattributed", "kw"].sum() / df["kw"].sum()), 4
        ),
    }
    folder = out_dir / "auctions"
    folder.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, data, n in (
        ("onshore.json", onshore, len(round_out)),
        ("awards.json", {"source": SOURCE, "awards": rows}, len(rows)),
    ):
        path = folder / name
        path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
        entries.append({"name": f"auctions/{name}", "rows": n, "bytes": path.stat().st_size})
    return entries


def check(out_dir: Path, rounds: list[dict]) -> None:
    """Fail loudly if the auction files are incomplete or implausible."""
    try:
        onshore = json.loads((out_dir / "auctions" / "onshore.json").read_text())
        awards = json.loads((out_dir / "auctions" / "awards.json").read_text())["awards"]
    except (OSError, ValueError, KeyError) as exc:
        raise AuctionCheckError(f"auction files missing or unreadable: {exc}") from exc
    problems = []
    if [r["id"] for r in onshore["rounds"]] != [r["id"] for r in rounds]:
        problems.append("onshore.json: rounds differ from settings.")
    for r in onshore["rounds"]:
        need = ("bid_date", "published", "ceiling_ct", "min_ct", "avg_ct", "max_ct", "awarded_kw")
        if missing := [k for k in need if r.get(k) is None]:
            problems.append(f"{r['id']}: page gave no {', '.join(missing)}.")
            continue
        if not r["min_ct"] <= r["avg_ct"] <= r["max_ct"] <= r["ceiling_ct"]:
            problems.append(f"{r['id']}: prices out of order.")
        if abs(r["list_kw"] / r["awarded_kw"] - 1) > LIST_TOLERANCE:
            problems.append(
                f"{r['id']}: award list {r['list_kw']:.0f} kW vs page {r['awarded_kw']} kW."
            )
        if r["turbines"] and r["turbines_in_mastr"] / r["turbines"] < MIN_LINKED:
            problems.append(
                f"{r['id']}: only {r['turbines_in_mastr']}/{r['turbines']} turbines found in MaStR."
            )
        if abs(sum(r["kw_by_category"].values()) - r["list_kw"]) > 1:
            problems.append(f"{r['id']}: categories do not add up.")
    if len(awards) != sum(r["list_awards"] for r in onshore["rounds"]):
        problems.append("awards.json: row count differs from the rounds.")
    if problems:
        raise AuctionCheckError("; ".join(problems))
