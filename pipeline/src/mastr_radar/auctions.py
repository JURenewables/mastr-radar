"""Onshore wind auctions (contract v1.6 draft).

A1 fetch: the BNetzA page of each finished onshore round (prices, volumes),
its award list (.xlsx) and the DWD wind grid into ``data/auctions/``.
A2 build (part of station 3): rounds, winners by company group, the turbines
behind each award (linked to MaStR via the register numbers) with their
estimated full-load hours, EEG quality and correction factor →
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

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import requests
import yaml

from mastr_radar import monitor, wind

BASE = "https://www.bundesnetzagentur.de"
ROUND_PAGE = (
    BASE + "/DE/Fachthemen/ElektrizitaetundGas/Ausschreibungen/{programme}/"
    "BeendeteAusschreibungen/{path}"
)
GROUPS_CONFIG = Path(__file__).resolve().parents[2] / "config" / "auction_groups.yaml"
REVIEWED_CONFIG = Path(__file__).resolve().parents[2] / "config" / "auction_reviewed.yaml"
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
STATES = [
    "Baden-Württemberg",
    "Bayern",
    "Berlin",
    "Brandenburg",
    "Bremen",
    "Hamburg",
    "Hessen",
    "Mecklenburg-Vorpommern",
    "Niedersachsen",
    "Nordrhein-Westfalen",
    "Rheinland-Pfalz",
    "Saarland",
    "Sachsen",
    "Sachsen-Anhalt",
    "Schleswig-Holstein",
    "Thüringen",
]
SOURCE = "Bundesnetzagentur, Ausschreibungen Wind an Land (www.bundesnetzagentur.de)"
AWARD_NO = re.compile(r"(WIN|SOL|INN|GEM)\d", re.IGNORECASE)
REGISTER_ID = re.compile(r"\b(SEE\d{12}|EEG\d{12}|A\d{13})\b")
TURBINE_KW = re.compile(r"\((SEE\d{12}|EEG\d{12}),\s*([\d.]+(?:,\d+)?) kW\)")
LIST_TOLERANCE = 0.10  # award list vs published total (late awards, court rulings)
LIST_TOLERANCE_MASTR = 0.20  # when the list has no kW and MaStR capacities are summed
MIN_LINKED = 0.90
MIN_YIELD_SHARE = 0.80  # share of awarded kW with a yield estimate
TOP_WINNERS = 20
RACE_GROUPS = 15
REALISED_AFTER_MONTHS = 36

CITIZEN_ALL = "Citizen & local (all)"
OTHER_MUNICIPAL = "Other Stadtwerke"
NOT_ATTRIBUTED = "Not attributed"


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


def fetch(rounds: list[dict], cache_dir: Path, grids: bool = True) -> int:
    """Download what is not cached yet: round pages, award lists, DWD wind grid."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    new = 0
    for rnd in rounds:
        page = cache_dir / f"{rnd['id']}.html"
        if not page.exists():  # finished rounds do not change
            url = ROUND_PAGE.format(
                programme=rnd.get("programme", "Wind_Onshore"), path=rnd["path"]
            )
            page.write_text(_get(url).text, encoding="utf-8")
            new += 1
        xlsx = cache_dir / f"{rnd['id']}.xlsx"
        if not xlsx.exists():
            text = page.read_text("utf-8")
            link = re.search(r'href="([^"]+Zuschlagslisten/[^"]+\.xlsx)[^"]*"', text) or re.search(
                r'href="([^"]*(?:[Zz]uschl|[Ll]iste)[^"]*\.xlsx)[^"]*"', text
            )
            if not link:
                raise AuctionCheckError(f"{rnd['id']}: no award list linked on the round page.")
            xlsx.write_bytes(_get(BASE + html.unescape(link.group(1))).content)
            new += 1
    return new + (wind.fetch_grids(cache_dir / "dwd") if grids else 0)


# --- Parsing ----------------------------------------------------------------


def _num(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _date(s: str) -> str:
    d, m, y = re.match(r"(\d+)\. (\w+) (\d{4})", s).groups()
    return date(int(y), MONTHS[m], int(d)).isoformat()


def _first(t: str, patterns: list[str]) -> re.Match | None:
    for p in patterns:
        if m := re.search(p, t):
            return m
    return None


def parse_round_page(text: str) -> dict:
    """Published results of one round from its BNetzA page (wording varies by year)."""
    t = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", text)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t)).replace("\xad", "")
    t = re.sub(r"\s+", " ", t).replace("Zuschlagswe rt", "Zuschlagswert")
    num = r"(\d+,\d+)"
    keys = "bid_date published ceiling_ct volume_kw min_ct max_ct avg_ct awards awarded_kw"
    out: dict = dict.fromkeys(keys.split())
    if m := _first(
        t, [r"Gebotstermin ist der (\d+\. \w+ \d{4})", r"Gebotstermin (\d+\. \w+ \d{4})"]
    ):
        out["bid_date"] = _date(m.group(1))
    if m := _first(
        t, [r"Veröffentlichung am (\d+\. \w+ \d{4})", r"Bekanntmachung war am (\d+\. \w+ \d{4})"]
    ):
        out["published"] = _date(m.group(1))
    ceiling_in_table = rf"Höchstwert.{{0,160}}?\d{{1,3}}(?:\.\d{{3}})+ (?:kW|Kilowatt) {num} ct"
    if m := _first(t, [rf"Höchstwert für diesen Gebotstermin beträgt {num}", ceiling_in_table]):
        out["ceiling_ct"] = _num(m.group(1))
    if m := _first(t, [r"Ausschreibungsvolumen beträgt ([\d.]+)"]):
        out["volume_kw"] = int(_num(m.group(1)))
    if m := re.search(
        rf"niedrigste und der höchste Gebotswert.{{0,160}}?bei {num} ct/kWh bzw\. {num}", t
    ):
        out["min_ct"], out["max_ct"] = _num(m.group(1)), _num(m.group(2))
    verb = r"(?:beträgt|betrug|liegt bei|lag bei)"
    if out["min_ct"] is None and (
        m := re.search(rf"niedrigste (?:Gebots)?[Ww]ert.{{0,80}}?{verb} {num}", t)
    ):
        out["min_ct"] = _num(m.group(1))
    high = rf"höchsten? (?:Gebots|Zuschlags)?[Ww]ert.{{0,80}}?{verb} {num}"
    if out["max_ct"] is None and (m := re.search(high, t)):
        out["max_ct"] = _num(m.group(1))
    if m := re.search(rf"Zuschlagswert(?: \([^)]*\))? (?:beträgt|entspricht|betrug) {num}", t):
        out["avg_ct"] = _num(m.group(1))
    if m := re.search(r"Es (?:wurden|werden) ([\d.]+) Gebote", t):
        out["awards"] = int(_num(m.group(1)))
    if m := re.search(r"(?:Gebotsvolumen|Gebotsmenge) von ([\d.]+) (kW|MW) bezuschlagt", t):
        out["awarded_kw"] = int(_num(m.group(1)) * (1000 if m.group(2) == "MW" else 1))
    return out


def _norm(cell) -> str:
    return re.sub(r"\s+", " ", str(cell or "")).strip().lower().replace(".", "").replace("- ", "-")


def _header(ws) -> tuple[int, dict[str, int]] | None:
    for i, row in enumerate(ws.iter_rows(max_row=20, values_only=True)):
        names = [_norm(c) for c in row]
        if "name des bieters" in names:
            return i, {n: j for j, n in enumerate(names) if n}
    return None


def _col(cols: dict[str, int], prefix: str) -> int | None:
    """Index of the first column whose name starts with ``prefix``."""
    return next((i for n, i in cols.items() if n.startswith(prefix)), None)


def _state_of(site: str) -> str | None:
    m = re.match(r"\s*(?:BLD )?([^,:]+)", site or "")
    return m.group(1).strip() if m and m.group(1).strip() in STATES else None


def parse_award_list(path: Path) -> list[dict]:
    """One dict per award: bidder, award number, kW (None if the list has none),
    state, turbine register numbers and per-turbine kW where the list gives it."""
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True)
    sheets = [(ws, h) for ws in wb.worksheets if (h := _header(ws))]
    compact = next(
        ((ws, h) for ws, h in sheets if _col(h[1], "angegebener standort") is not None), None
    )
    if compact is None:
        raise AuctionCheckError(f"{path.name}: no sheet with bidders and sites.")
    detail = next(
        (
            (ws, h)
            for ws, h in sheets
            if _col(h[1], "registernummer") is not None or _col(h[1], "anlagennummer") is not None
        ),
        None,
    ) or next(((ws, h) for ws, h in sheets if _col(h[1], "gemeinde") is not None), None)

    ws, (start, cols) = compact
    i_bid, i_award = cols["name des bieters"], _col(cols, "zuschlags-nr")
    i_site, i_kw = _col(cols, "angegebener standort"), _col(cols, "gebotsmenge")
    awards: dict[str, dict] = {}
    for row in ws.iter_rows(min_row=start + 2, values_only=True):
        if len(row) <= max(i_bid, i_award, i_site):
            continue
        no = str(row[i_award] or "").strip()
        if not row[i_bid] or not AWARD_NO.match(no):
            continue
        site = str(row[i_site] or "").replace("_x000D_", " ")
        kw = row[i_kw] if i_kw is not None and isinstance(row[i_kw], int | float) else None
        awards[no] = {
            "bidder": str(row[i_bid]).strip(),
            "award_no": no,
            "kw": float(kw) if kw is not None else None,
            "state": _state_of(site),
            "turbines": list(dict.fromkeys(REGISTER_ID.findall(site))),
            "turbine_kw": {r: _num(k) for r, k in TURBINE_KW.findall(site)},
        }
    if detail is not None:
        ws, (start, cols) = detail
        i_award = _col(cols, "zuschlags-nr")
        i_reg = _col(cols, "registernummer")
        i_reg = i_reg if i_reg is not None else _col(cols, "anlagennummer")
        i_state = _col(cols, "bundesland")
        i_mun, i_dis = _col(cols, "gemeinde"), _col(cols, "landkreis")
        for row in ws.iter_rows(min_row=start + 2, values_only=True):
            a = awards.get(str(row[i_award] or "").strip()) if len(row) > i_award else None
            if a is None:
                continue
            if i_state is not None and row[i_state] in STATES:
                a["state"] = a["state"] or row[i_state]
            if i_mun is not None and row[i_mun] and not a.get("municipality"):
                a["municipality"] = str(row[i_mun]).strip()
                a["district"] = (
                    str(row[i_dis]).strip() if i_dis is not None and row[i_dis] else None
                )
            reg = str(row[i_reg] or "").strip() if i_reg is not None else ""
            if REGISTER_ID.fullmatch(reg) and reg not in a["turbines"]:
                a["turbines"].append(reg)
    return list(awards.values())


def attribute(bidder: str, cfg: dict) -> tuple[str | None, str]:
    """(group, category) of a bidder; (None, 'unattributed') if the name tells nothing."""
    name = bidder.lower()
    for g in cfg["groups"]:
        if re.search(g["match"], name):
            return g["group"], g["category"]
    return None, "unattributed"


def reviewed_group(bidder: str, round_id: str, award_no: str, reviewed: dict) -> dict | None:
    """The reviewed assignment covering this award, if any."""
    for a in reviewed.get("assignments", []):
        if a["bidder"] != bidder or a.get("round", round_id) != round_id:
            continue
        if award_no in a.get("award_nos", [award_no]):
            return a
    return None


def category_of(group: str, cfg: dict) -> str:
    return next((g["category"] for g in cfg["groups"] if g["group"] == group), "developer")


def is_legal_entity(bidder: str, cfg: dict) -> bool:
    return re.search(cfg["legal_entity"], bidder.lower()) is not None


def display_group(group: str | None, category: str, buckets: set[str]) -> tuple[str, bool]:
    """Name used in rankings, and whether it stands for many companies (a bucket)."""
    if group is None:
        return NOT_ATTRIBUTED, True
    if category == "citizen":
        return CITIZEN_ALL, True
    if group in buckets:
        return OTHER_MUNICIPAL if category == "municipal" else group, True
    return group, False


# --- A2 build ---------------------------------------------------------------

UNIT_COLS = [
    "unit_id",
    "eeg_id",
    "technology",
    "status",
    "manufacturer",
    "turbine_model",
    "capacity_kw",
    "commissioning_date",
    "lat",
    "lon",
    "hub_height_m",
    "rotor_diameter_m",
    "operator_id",
]


def address_key(street, house_number, postcode) -> str:
    """Comparable office address: street + number + postcode, letters and digits only."""

    def norm(x) -> str:
        t = str(x or "").lower().replace("straße", "str").replace("strasse", "str")
        return re.sub(r"[^a-z0-9äöü]", "", t)

    return f"{norm(street)}|{norm(house_number)}|{norm(postcode)}"


def office_groups(
    parsed: list, linked: pd.DataFrame, ops_path: Path, cfg: dict, reviewed: dict
) -> dict[tuple[str, str], tuple[str, str]]:
    """Unknown awards whose operator company sits at a group's office.

    An office belongs to a group when every named company registered there
    belongs to it, or when at least 2 do and they make up 60 % of the named
    companies; reviewed addresses (auction_reviewed.yaml) take precedence.
    Returns (round, award) → (group, address key). Addresses stay internal.
    """
    if not ops_path.exists():
        return {}
    buckets = {g["group"] for g in cfg["groups"] if g.get("bucket")}
    ops = pq.read_table(ops_path).to_pandas()
    ops["addr"] = [
        address_key(*v)
        for v in zip(ops["street"], ops["house_number"], ops["postcode"], strict=True)
    ]
    addr_of = dict(zip(ops["operator_id"], ops["addr"], strict=True))
    by_name = dict(zip(ops["name"].str.lower(), ops["addr"], strict=True))
    wanted: dict[tuple[str, str], str] = {}
    for rnd, _, awards in parsed:
        for a in awards:
            if (
                reviewed_group(a["bidder"], rnd["id"], a["award_no"], reviewed)
                or attribute(a["bidder"], cfg)[0]
            ):
                continue
            if any(
                e["bidder"] == a["bidder"] and e.get("round", rnd["id"]) == rnd["id"]
                for e in reviewed.get("office_exclusions", [])
            ):
                continue
            op_ids = [linked.at[r, "operator_id"] for r in a["turbines"] if r in linked.index]
            op_ids = [o for o in op_ids if isinstance(o, str)]
            addr = addr_of.get(max(set(op_ids), key=op_ids.count)) if op_ids else None
            addr = addr or by_name.get(a["bidder"].lower())
            if addr:
                wanted[(rnd["id"], a["award_no"])] = addr
    labels: dict[str, str] = {}
    for addr, names in ops[ops["addr"].isin(set(wanted.values()))].groupby("addr")["name"]:
        groups = [g for n in names if (g := attribute(n, cfg)[0]) and g not in buckets]
        if not groups:
            continue
        top = max(set(groups), key=groups.count)
        n = groups.count(top)
        if n == len(groups) or (n >= 2 and n / len(groups) >= 0.6):
            labels[addr] = top
    for e in reviewed.get("addresses", []):
        labels[address_key(e["street"], e["house_number"], e["postcode"])] = e["group"]
    return {k: (labels[a], a) for k, a in wanted.items() if a in labels}


def _load_turbines(units_path: Path) -> pd.DataFrame:
    df = pq.read_table(units_path, columns=UNIT_COLS).to_pandas()
    df = df[df["technology"] == "wind_onshore"]
    by_eeg = df.dropna(subset=["eeg_id"]).drop_duplicates("eeg_id").set_index("eeg_id")
    both = pd.concat([df.set_index("unit_id", drop=False), by_eeg])
    return both[~both.index.duplicated()]


def _weighted(values, weights) -> float | None:
    v, w = np.asarray(values, float), np.asarray(weights, float)
    ok = np.isfinite(v) & (w > 0)
    return float(np.sum(v[ok] * w[ok]) / np.sum(w[ok])) if ok.any() else None


def _r(x, nd=0):
    return None if x is None or not np.isfinite(x) else (round(x, nd) if nd else int(round(x)))


def _fleet(units_path: Path, cfg: dict, buckets: set[str]) -> dict:
    """Onshore wind in operation by operator group (operator names from MaStR)."""
    cols = ["technology", "status", "capacity_kw", "operator_name", "operator_is_person"]
    df = pq.read_table(units_path, columns=cols).to_pandas()
    df = df[(df["technology"] == "wind_onshore") & (df["status"] == "operating")]
    named = df["operator_name"].notna() & ~df["operator_is_person"].fillna(False).astype(bool)
    total = float(df["capacity_kw"].sum())
    rows = defaultdict(lambda: [0.0, ""])
    by_cat = defaultdict(float)
    for name, kw in df.loc[named].groupby("operator_name")["capacity_kw"].sum().items():
        group, cat = attribute(name, cfg)
        disp, _ = display_group(group, cat, buckets)
        rows[disp][0] += kw
        rows[disp][1] = cat
        by_cat[cat] += kw
    private = float(df.loc[~named, "capacity_kw"].sum())
    by_cat["unattributed"] += private
    rows[NOT_ATTRIBUTED][0] += private
    rows[NOT_ATTRIBUTED][1] = "unattributed"
    ranked = sorted(rows.items(), key=lambda kv: -kv[1][0])
    return {
        "total_mw": _r(total / 1000),
        "groups": [
            {
                "group": g,
                "category": c,
                "mw": _r(kw / 1000),
                "share": round(kw / total, 4),
                "bucket": g in (CITIZEN_ALL, OTHER_MUNICIPAL, NOT_ATTRIBUTED),
            }
            for g, (kw, c) in ranked[: TOP_WINNERS + 3]
        ],
        "mw_by_category": {k: _r(by_cat.get(k, 0.0) / 1000) for k in cfg["categories"]},
    }


def build(rounds: list[dict], cache_dir: Path, units_path: Path, out_dir: Path) -> list[dict]:
    """Write auctions/onshore.json and auctions/awards.json. Returns manifest entries."""
    cfg = yaml.safe_load(GROUPS_CONFIG.read_text())
    reviewed = yaml.safe_load(REVIEWED_CONFIG.read_text()) if REVIEWED_CONFIG.exists() else {}
    used_assignments: set[int] = set()
    known = {g["group"] for g in cfg["groups"]}
    if bad := [a["group"] for a in reviewed.get("assignments", []) if a["group"] not in known]:
        raise AuctionCheckError(f"auction_reviewed.yaml: unknown groups {bad}")
    if bad := [
        e["round"]
        for e in reviewed.get("reported", [])
        if e["round"] not in {r["id"] for r in rounds}
    ]:
        raise AuctionCheckError(f"auction_reviewed.yaml: reported rounds not in settings {bad}")
    brands_cfg = yaml.safe_load(monitor.BRANDS_CONFIG.read_text())
    wcfg = wind.load_config()
    buckets = {g["group"] for g in cfg["groups"] if g.get("bucket")}
    cats = list(cfg["categories"])
    units = _load_turbines(units_path)
    as_of = monitor_as_of(units_path)

    # Every awarded turbine, linked to MaStR, with its estimated yield.
    parsed = []
    for rnd in rounds:
        page = parse_round_page((cache_dir / f"{rnd['id']}.html").read_text(encoding="utf-8"))
        parsed.append((rnd, page, parse_award_list(cache_dir / f"{rnd['id']}.xlsx")))
    regs = sorted({r for _, _, aw in parsed for a in aw for r in a["turbines"]} & set(units.index))
    linked = units.loc[regs].copy()
    grid = wind.WindGrid.load(cache_dir / "dwd", wcfg)
    has_xy = linked["lat"].notna() & linked["lon"].notna()
    site = grid.sample(linked.loc[has_xy, "lon"].to_numpy(), linked.loc[has_xy, "lat"].to_numpy())
    for k, v in site.items():
        linked.loc[has_xy, k] = v
    yields = {}
    for reg, u in linked.iterrows():
        y = wind.turbine_yield(
            u["capacity_kw"],
            u["rotor_diameter_m"],
            u["hub_height_m"],
            {k: u.get(k, np.nan) for k in ("v100", "v80", "k80")},
            wcfg,
        )
        if y:
            yields[reg] = y

    # Calibrate the modelled quality factor with the ratios operators declare in
    # MaStR (estimated yield / reference yield, the basis of the EEG correction).
    det_path = units_path.with_name("unit_details.parquet")
    det = (
        pq.read_table(det_path).to_pandas().set_index("unit_id")
        if det_path.exists()
        else pd.DataFrame()
    )
    declared = {}
    if len(det):
        dr = det["yield_ratio_pct"].dropna()
        dr = dr[(dr >= 30) & (dr <= 160)]
        declared = dr.to_dict()
    calib = _calibrate(det, units, grid, wcfg, declared)
    for reg, y in yields.items():
        uid = (
            reg
            if reg in declared
            else linked.at[reg, "unit_id"]
            if "unit_id" in linked.columns
            else reg
        )
        if uid in declared:
            y["quality_pct"], y["quality_source"] = declared[uid], "declared"
        else:
            y["quality_pct"], y["quality_source"] = y["quality_pct"] * calib["factor"], "model"

    offices = office_groups(
        parsed, linked, units_path.with_name("operators.parquet"), cfg, reviewed
    )

    rows, round_out, merit = [], [], {}
    for rnd, page, awards in parsed:
        year = int(page["bid_date"][:4]) if page["bid_date"] else None
        cat_kw: dict[str, float] = defaultdict(float)
        makers: dict[str, float] = defaultdict(float)
        n_turb = n_linked = n_online = n_old = 0
        kw_sources: dict[str, int] = defaultdict(int)
        merit_rows = []
        for a in awards:
            rev = reviewed_group(a["bidder"], rnd["id"], a["award_no"], reviewed)
            if rev:
                group, cat, how = rev["group"], category_of(rev["group"], cfg), "reviewed"
                used_assignments.add(id(rev))
            else:
                group, cat = attribute(a["bidder"], cfg)
                how = "name" if group else "none"
                if not group and (rnd["id"], a["award_no"]) in offices:
                    group = offices[(rnd["id"], a["award_no"])][0]
                    cat, how = category_of(group, cfg), "office"
            mine = [r for r in a["turbines"] if r in linked.index]
            lk = linked.loc[mine]
            if a["kw"] is not None:
                kw, src = a["kw"], "list"
            elif a["turbine_kw"]:
                kw, src = sum(a["turbine_kw"].values()), "list"
            else:
                kw, src = float(lk["capacity_kw"].fillna(0).sum()), "mastr"
            kw_sources[src] += 1
            cat_kw[cat] += kw
            n_turb += sum(not r.startswith("A") for r in a["turbines"])
            n_old += sum(r.startswith("A") for r in a["turbines"])
            n_linked += len(mine)
            operating = lk[lk["status"] == "operating"]
            n_online += len(operating)
            brands = [monitor.brand_of(m, brands_cfg) for m in lk["manufacturer"]]
            for b, c in zip(brands, lk["capacity_kw"].fillna(0), strict=True):
                makers[b] += c
            models = [
                m
                for b, t in zip(brands, lk["turbine_model"], strict=True)
                if (m := monitor.model_family(b, t, brands_cfg))
            ]
            ys = [(yields[r], linked.at[r, "capacity_kw"]) for r in mine if r in yields]
            w = [c for _, c in ys]
            flh = _weighted([y["flh"] for y, _ in ys], w)
            quality = _weighted([y["quality_pct"] for y, _ in ys], w)
            corr = _weighted(
                [wind.correction_factor(y["quality_pct"], year, a["state"], wcfg) for y, _ in ys], w
            )
            months = [
                (pd.Timestamp(d) - pd.Timestamp(page["bid_date"])).days / 30.44
                for d in operating["commissioning_date"].dropna()
            ]
            disp, is_bucket = display_group(group, cat, buckets)
            pts = lk.dropna(subset=["lat", "lon"])
            public = is_legal_entity(a["bidder"], cfg)
            row = {
                "round": rnd["id"],
                "bid_date": page["bid_date"],
                "award_no": a["award_no"],
                # Names and places of possible natural persons are never published (D4).
                "bidder": a["bidder"] if public else None,
                "group": group,
                "attribution": how,
                "rank_group": disp,
                "category": cat,
                "kw": kw,
                "kw_source": src,
                "state": a["state"],
                "turbines": len(a["turbines"]),
                "turbines_in_mastr": len(mine),
                "turbines_operating": len(operating),
                "kw_in_mastr": float(lk["capacity_kw"].fillna(0).sum()),
                "kw_operating": float(operating["capacity_kw"].fillna(0).sum()),
                "months_to_operation": _r(float(np.median(months)), 1) if months else None,
                "maker": max(set(brands), key=brands.count) if brands else None,
                "grid_voltage": _mode(det, lk["unit_id"] if "unit_id" in lk.columns else []),
                "model": max(set(models), key=models.count) if models else None,
                "hub_height_m": _r(_weighted(lk["hub_height_m"], lk["capacity_kw"])),
                "rotor_diameter_m": _r(_weighted(lk["rotor_diameter_m"], lk["capacity_kw"])),
                "wind_ms": _r(_weighted([y["wind_ms"] for y, _ in ys], w), 2),
                "full_load_hours": _r(flh),
                "quality_pct": _r(quality, 1),
                "correction_factor": _r(corr, 3),
                "received_ct_est": _r(page["avg_ct"] * corr, 2)
                if corr and page["avg_ct"]
                else None,
                "lat": round(float(pts["lat"].mean()), 2) if public and len(pts) else None,
                "lon": round(float(pts["lon"].mean()), 2) if public and len(pts) else None,
            }
            rows.append(row)
            if flh is not None:
                merit_rows.append(
                    [round(kw / 1000, 2), int(round(flh)), round(quality), cats.index(cat)]
                )
        rr = [r for r in rows if r["round"] == rnd["id"]]
        kw_y = [r["kw"] if r["full_load_hours"] is not None else 0 for r in rr]
        flh_avg = _weighted([r["full_load_hours"] or np.nan for r in rr], kw_y)
        q_avg = _weighted([r["quality_pct"] or np.nan for r in rr], kw_y)
        c_avg = _weighted([r["correction_factor"] or np.nan for r in rr], kw_y)
        list_kw = sum(r["kw"] for r in rr)
        round_out.append(
            {
                "id": rnd["id"],
                **page,
                "list_kw": list_kw,
                "list_awards": len(awards),
                "kw_source": "list" if kw_sources["mastr"] == 0 else "mastr",
                "kw_by_category": {k: cat_kw.get(k, 0.0) for k in cats},
                "kw_by_maker": dict(sorted(makers.items(), key=lambda kv: -kv[1])),
                "turbines": n_turb,  # with a MaStR id (SEE…/EEG…)
                "turbines_old_id": n_old,  # old register numbers (A…), not linkable
                "turbines_in_mastr": n_linked,
                "turbines_operating": n_online,
                "yield_share": round(sum(kw_y) / list_kw, 3) if list_kw else 0.0,
                "full_load_hours_avg": _r(flh_avg),
                "quality_pct_avg": _r(q_avg, 1),
                "correction_factor_avg": _r(c_avg, 3),
                "received_ct_est": _r(page["avg_ct"] * c_avg, 2)
                if c_avg and page["avg_ct"]
                else None,
            }
        )
        merit[rnd["id"]] = sorted(merit_rows, key=lambda m: -m[1])

    df = pd.DataFrame(rows)
    df["year"] = df["bid_date"].str[:4]
    years = sorted(df["year"].unique())

    def ranking(g: pd.DataFrame) -> list[dict]:
        total = float(g["kw"].sum())
        agg = (
            g.groupby(["rank_group"])
            .agg(
                kw=("kw", "sum"),
                awards=("kw", "size"),
                rounds=("round", "nunique"),
                category=("category", "first"),
            )
            .reset_index()
            .sort_values("kw", ascending=False)
            .head(TOP_WINNERS)
        )
        return [
            {
                "group": r.rank_group,
                "category": r.category,
                "kw": float(r.kw),
                "share": round(float(r.kw) / total, 4),
                "awards": int(r.awards),
                "rounds": int(r.rounds),
                "bucket": r.rank_group in (CITIZEN_ALL, OTHER_MUNICIPAL, NOT_ATTRIBUTED)
                or r.rank_group in buckets,
            }
            for r in agg.itertuples()
        ]

    winners = {y: ranking(g) for y, g in df.groupby("year")}
    winners["all"] = ranking(df)
    top = (
        df[~df["rank_group"].isin([CITIZEN_ALL, OTHER_MUNICIPAL, NOT_ATTRIBUTED])]
        .groupby("rank_group")["kw"]
        .sum()
        .sort_values(ascending=False)
        .head(RACE_GROUPS)
        .index
    )
    race_groups = list(top) + [CITIZEN_ALL, OTHER_MUNICIPAL, NOT_ATTRIBUTED]
    pivot = df.pivot_table(
        index="rank_group", columns="year", values="kw", aggfunc="sum", fill_value=0
    )
    cat_pivot = df.pivot_table(
        index="category", columns="year", values="kw", aggfunc="sum", fill_value=0
    )
    first_cat = df.groupby("rank_group")["category"].first()

    # What sets the bidder types apart (data, not opinion).
    cutoff = (pd.Timestamp(as_of) - pd.DateOffset(months=REALISED_AFTER_MONTHS)).date().isoformat()
    drivers = {}
    for c in cats:
        g = df[df["category"] == c]
        old = g[g["bid_date"] <= cutoff]
        drivers[c] = {
            "awarded_mw": _r(g["kw"].sum() / 1000),
            "awards": int(len(g)),
            "median_award_mw": _r(float(g["kw"].median()) / 1000, 1) if len(g) else None,
            "full_load_hours_avg": _r(_weighted(g["full_load_hours"].astype(float), g["kw"])),
            "quality_pct_avg": _r(_weighted(g["quality_pct"].astype(float), g["kw"]), 1),
            # Of the turbines awarded before the cut-off and found in MaStR: share in operation.
            "realised_share": round(float(old["kw_operating"].sum() / old["kw_in_mastr"].sum()), 3)
            if old["kw_in_mastr"].sum() > 0
            else None,
            "median_months_to_operation": _r(float(g["months_to_operation"].dropna().median()), 1)
            if g["months_to_operation"].notna().any()
            else None,
            "distinct_bidders": int(g["bidder"].nunique()),
        }

    operating_from_awards = (
        df.groupby("rank_group")
        .agg(kw=("kw_operating", "sum"), category=("category", "first"))
        .sort_values("kw", ascending=False)
        .head(TOP_WINNERS)
    )
    onshore = {
        "source": SOURCE,
        "categories": cfg["categories"],
        "rounds": round_out,
        "merit_order": merit,
        "winners_by_year": winners,
        "race": {
            "years": years,
            "groups": race_groups,
            "categories": [
                str(first_cat[g]) if g in first_cat else "unattributed" for g in race_groups
            ],
            "kw": {
                g: [float(pivot.at[g, y]) if g in pivot.index else 0.0 for y in years]
                for g in race_groups
            },
        },
        "kw_by_category_year": {
            c: [float(cat_pivot.at[c, y]) if c in cat_pivot.index else 0.0 for y in years]
            for c in cats
        },
        "operating_from_awards": [
            {"group": g, "category": r.category, "mw": _r(r.kw / 1000)}
            for g, r in operating_from_awards.iterrows()
            if r.kw > 0
        ],
        "fleet": _fleet(units_path, cfg, buckets),
        "drivers": drivers,
        "drivers_realised_cutoff": cutoff,
        "points": _points(df, cats),
        "kw_by_state_year": {
            st: [float(df.loc[(df["state"] == st) & (df["year"] == y), "kw"].sum()) for y in years]
            for st in sorted(df["state"].dropna().unique())
        },
        "company_profiles": _profiles(df, years, cutoff),
        "dynamics": dynamics(
            df, years, [r["id"] for r in round_out], [r["bid_date"] for r in round_out]
        ),
        "median_award_mw": round(float(df.loc[df["kw"] > 0, "kw"].median()) / 1000, 1),
        "company_reported": _reported(reviewed, round_out, df),
        "reviewed_awards": int((df["attribution"] == "reviewed").sum()),
        "attribution_kw": {
            k: float(df.loc[df["attribution"] == k, "kw"].sum())
            for k in ("reviewed", "name", "office", "none")
        },
        "unattributed_share": round(
            float(df.loc[df["category"] == "unattributed", "kw"].sum() / df["kw"].sum()), 4
        ),
        "success": _success(df, det, units, grid, wcfg, declared, calib, linked),
        "model": {
            "calibration": calib,
            "wind": "DWD 200 m grid: mean wind 1981–2000 at 80/100 m, Weibull k at 80 m",
            "losses": wcfg["losses"],
            "power_coefficient": wcfg["power_curve"]["power_coefficient"],
            "reference_site": wcfg["reference_site"],
            "correction_tables": {k: v["points"] for k, v in wcfg["correction_tables"].items()},
        },
    }
    stale = [a["bidder"] for a in reviewed.get("assignments", []) if id(a) not in used_assignments]
    if stale:
        raise AuctionCheckError(f"auction_reviewed.yaml: assignments match no award: {stale}")
    folder = out_dir / "auctions"
    folder.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, data, n in (
        ("onshore.json", onshore, len(round_out)),
        ("awards.json", {"source": SOURCE, "awards": rows}, len(rows)),
    ):
        path = folder / name
        path.write_text(
            json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        )
        entries.append({"name": f"auctions/{name}", "rows": n, "bytes": path.stat().st_size})
    return entries


PROFILE_MIN_KW = 50_000


def _profiles(df: pd.DataFrame, years: list[str], cutoff: str) -> list[dict]:
    """Per named company group: awards by year, regions, turbine makers, sites, delivery."""
    named = df[df["group"].notna() & (df["rank_group"] == df["group"])]
    out = []
    for g, d in named.groupby("group"):
        if d["kw"].sum() < PROFILE_MIN_KW:
            continue
        old = d[d["bid_date"] <= cutoff]
        makers = (
            d.dropna(subset=["maker"]).groupby("maker")["kw"].sum().sort_values(ascending=False)
        )
        states = (
            d.dropna(subset=["state"]).groupby("state")["kw"].sum().sort_values(ascending=False)
        )
        out.append(
            {
                "group": g,
                "category": d["category"].iloc[0],
                "kw_by_year": [float(d.loc[d["year"] == y, "kw"].sum()) for y in years],
                "awards": int(len(d)),
                "rounds": int(d["round"].nunique()),
                "first_bid": d.loc[d["kw"] > 0, "bid_date"].min(),
                "last_bid": d.loc[d["kw"] > 0, "bid_date"].max(),
                "median_award_mw": round(float(d["kw"].median()) / 1000, 1),
                "kw_by_state": {k: float(v) for k, v in states.head(6).items()},
                "states": int(states.size),
                "kw_by_maker": {k: float(v) for k, v in makers.items()},
                "full_load_hours_avg": _r(_weighted(d["full_load_hours"].astype(float), d["kw"])),
                "quality_pct_avg": _r(_weighted(d["quality_pct"].astype(float), d["kw"]), 1),
                "realised_share": round(
                    float(old["kw_operating"].sum() / old["kw_in_mastr"].sum()), 3
                )
                if old["kw_in_mastr"].sum() > 0
                else None,
                "attribution_kw": {
                    k: float(d.loc[d["attribution"] == k, "kw"].sum())
                    for k in ("reviewed", "name", "office")
                },
            }
        )
    return sorted(out, key=lambda p: -sum(p["kw_by_year"]))


def _points(df: pd.DataFrame, cats: list[str]) -> dict:
    """Award locations per round for the map: flat integer arrays, 6 per award
    (lon×100, lat×100, kW/100, category index, group index or −1, full-load
    hours or 0). Only awards with a public location (companies, D4)."""
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
                0 if pd.isna(r.full_load_hours) else int(r.full_load_hours),
            ]
        )
    return {"groups": groups, "rounds": rounds}


def _reported(reviewed: dict, rounds: list[dict], df: pd.DataFrame) -> list[dict]:
    """Company-announced totals per round next to ours."""
    by_id = {r["id"]: r for r in rounds}
    out = []
    for e in reviewed.get("reported", []):
        r = by_id.get(e["round"])
        if r is None:
            continue
        ours = (
            float(df.loc[(df["round"] == e["round"]) & (df["group"] == e["group"]), "kw"].sum())
            / 1000
        )
        out.append(
            {
                "group": e["group"],
                "round": e["round"],
                "bid_date": r["bid_date"],
                "reported_mw": float(e["mw"]),
                "qualifier": e.get("qualifier", "exact"),
                "ours_mw": round(ours, 1),
                "note": e.get("note"),
                "source": e["source"],
            }
        )
    return out


DYN_MIN_KW = 100_000


def dynamics(
    df: pd.DataFrame, years: list[str], round_ids: list[str], bid_dates: list[str], recent: int = 6
) -> dict:
    """Rise and fall of company groups: share early vs late, consistency, volatility.

    Shared by wind and solar. `early`/`late` = first and last third of the years
    (at least one year each); the running year counts as late.
    """
    named = df[df["group"].notna() & (df["rank_group"] == df["group"])]
    total_by_year = df.groupby("year")["kw"].sum()
    k = max(1, len(years) // 3)
    early, late = years[:k], years[-k:]
    order = {r: i for i, r in enumerate(round_ids)}
    rows = []
    for g, d in named.groupby("group"):
        kw = d["kw"].sum()
        if kw < DYN_MIN_KW:
            continue
        by_year = [float(d.loc[d["year"] == y, "kw"].sum()) for y in years]
        share = [
            v / float(total_by_year.get(y, 0) or 1) for v, y in zip(by_year, years, strict=True)
        ]
        won = sorted({order[r] for r in d["round"]})
        possible = len(round_ids) - won[0]
        active = [v for v, y in zip(by_year, years, strict=True) if y >= d["year"].min()]
        mean = float(np.mean(active)) if active else 0
        cv = float(np.std(active) / mean) if mean else None
        e, l_ = float(np.mean(share[:k])), float(np.mean(share[-k:]))
        first, last = d["bid_date"].min(), d["bid_date"].max()
        n = len(round_ids)
        if won[0] >= n * 2 / 3:
            status = "new"  # first award in the last third of the rounds
        elif won[-1] < n - recent:
            status = "dropped"  # no award in the last `recent` rounds
        elif l_ - e >= 0.005:
            status = "rising"
        elif l_ - e <= -0.005:
            status = "fading"
        else:
            status = "steady"
        rows.append(
            {
                "group": g,
                "category": d["category"].iloc[0],
                "mw": round(float(kw) / 1000),
                "kw_by_year": by_year,
                "share_early": round(e, 4),
                "share_late": round(l_, 4),
                "momentum_pp": round((l_ - e) * 100, 2),
                "rounds_won": len(won),
                "rounds_possible": possible,
                "hit_rate": round(len(won) / possible, 3) if possible else None,
                "volatility": None if cv is None else round(cv, 2),
                "first_bid": first,
                "last_bid": last,
                "status": status,
            }
        )
    rows.sort(key=lambda r: -r["mw"])
    return {"years": years, "early": early, "late": late, "recent_rounds": recent, "groups": rows}


def _mode(det: pd.DataFrame, ids) -> str | None:
    if not len(det):
        return None
    v = det.reindex(list(ids))["grid_voltage"].dropna()
    return v.mode().iloc[0] if len(v) else None


def _model_quality(rows: pd.DataFrame, grid, wcfg: dict) -> pd.Series:
    """Modelled (uncalibrated) quality factor for turbines with location and size."""
    r = rows.dropna(subset=["lat", "lon", "hub_height_m", "rotor_diameter_m", "capacity_kw"])
    if r.empty:
        return pd.Series(dtype=float)
    site = grid.sample(r["lon"].to_numpy(), r["lat"].to_numpy())
    out = {}
    for i, (uid, x) in enumerate(r.iterrows()):
        y = wind.turbine_yield(
            x["capacity_kw"],
            x["rotor_diameter_m"],
            x["hub_height_m"],
            {k: site[k][i] for k in ("v100", "v80", "k80")},
            wcfg,
        )
        if y:
            out[uid] = y["quality_pct"]
    return pd.Series(out, dtype=float)


def _calibrate(det: pd.DataFrame, units: pd.DataFrame, grid, wcfg: dict, declared: dict) -> dict:
    """Median ratio declared / modelled over turbines that have both."""
    if not declared:
        return {"factor": 1.0, "n": 0}
    u = units.drop_duplicates("unit_id").set_index("unit_id")
    rows = u.loc[[i for i in declared if i in u.index]]
    model = _model_quality(rows, grid, wcfg)
    dec = pd.Series(declared).reindex(model.index)
    ok = model.notna() & dec.notna()
    if ok.sum() < 100:
        return {"factor": 1.0, "n": int(ok.sum())}
    return {
        "factor": round(float((dec[ok] / model[ok]).median()), 3),
        "n": int(ok.sum()),
        "correlation": round(float(np.corrcoef(model[ok], dec[ok])[0, 1]), 2),
        "median_declared": round(float(dec[ok].median()), 1),
        "median_model": round(float(model[ok].median()), 1),
    }


def _success(df, det, units, grid, wcfg, declared, calib, linked) -> dict:
    """What distinguishes winners: permitted turbines awarded vs not (yet), grid
    connection, and company volume vs site quality. Winners only are published by
    BNetzA, so the permitted pool stands in for the competitors."""
    out: dict = {}
    if len(det):
        u = units.drop_duplicates("unit_id").set_index("unit_id")
        w = det[det["technology"] == "wind_onshore"].join(
            u[["status", "capacity_kw", "lat", "lon", "hub_height_m", "rotor_diameter_m"]],
            how="left",
        )
        w = w[w["status"].isin(["planned", "operating"]) & w["permit_date"].notna()]
        w["permit_year"] = pd.to_datetime(w["permit_date"]).dt.year
        awarded_ids = set(linked["unit_id"]) if "unit_id" in linked.columns else set(linked.index)
        w["awarded"] = w["award_no"].fillna("").str.upper().str.startswith("WIN") | w.index.isin(
            awarded_ids
        )
        pool = w[(w["permit_year"] >= 2021) & (w["permit_year"] <= 2025)]
        out["permits_by_year"] = [
            {
                "year": int(y),
                "turbines": int(len(g)),
                "mw": round(float(g["capacity_kw"].sum()) / 1000),
                "awarded_share": round(float(g["awarded"].mean()), 3),
            }
            for y, g in pool.groupby("permit_year")
        ]
        mature = pool[pool["permit_year"] <= 2023].copy()
        mq = _model_quality(mature, grid, wcfg) * calib["factor"]
        q = pd.Series({i: declared.get(i, mq.get(i, np.nan)) for i in mature.index}, dtype=float)
        mature["quality"] = q
        bands = [0, 65, 75, 85, 95, 1000]
        labels = ["< 65 %", "65–75 %", "75–85 %", "85–95 %", "≥ 95 %"]
        mature["band"] = pd.cut(mature["quality"], bands, labels=labels, right=False)
        out["awarded_by_quality"] = [
            {
                "band": str(b),
                "turbines": int(len(g)),
                "awarded_share": round(float(g["awarded"].mean()), 3) if len(g) else None,
            }
            for b, g in mature.dropna(subset=["band"]).groupby("band", observed=False)
        ]
        volt = mature["grid_voltage"].fillna("unknown")
        out["awarded_by_voltage"] = [
            {
                "voltage": v,
                "turbines": int(len(g)),
                "awarded_share": round(float(g["awarded"].mean()), 3),
            }
            for v, g in mature.groupby(volt)
            if len(g) >= 30
        ]
        out["mature_pool_awarded_share"] = (
            round(float(mature["awarded"].mean()), 3) if len(mature) else None
        )
    # Grid connection of awarded capacity by bidder type (from linked units).
    if "grid_voltage" in df.columns:
        g = df.dropna(subset=["grid_voltage"])
        out["voltage_by_category"] = {
            c: {v: float(k) for v, k in d.groupby("grid_voltage")["kw"].sum().items()}
            for c, d in g.groupby("category")
        }
    # Company volume vs average site quality (named groups ≥ 100 MW).
    named = df[df["group"].notna() & (df["rank_group"] == df["group"])]
    vq = []
    for grp, d in named.groupby("group"):
        k = d.dropna(subset=["quality_pct"])
        if d["kw"].sum() >= 100_000 and len(k):
            vq.append(
                {
                    "group": grp,
                    "category": d["category"].iloc[0],
                    "mw": round(float(d["kw"].sum()) / 1000),
                    "quality_pct": round(
                        float((k["quality_pct"] * k["kw"]).sum() / k["kw"].sum()), 1
                    ),
                }
            )
    out["volume_vs_quality"] = vq
    if len(vq) >= 8:
        a = pd.DataFrame(vq)
        out["volume_quality_spearman"] = round(
            float(a["mw"].rank().corr(a["quality_pct"].rank())), 2
        )
    return out


def monitor_as_of(units_path: Path) -> date:
    from mastr_radar.aggregate import export_date_of

    return export_date_of(units_path)


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
        if missing := [k for k in ("bid_date", "avg_ct") if r.get(k) is None]:
            problems.append(f"{r['id']}: page gave no {', '.join(missing)}.")
            continue
        prices = [
            r[k] for k in ("min_ct", "avg_ct", "max_ct", "ceiling_ct") if r.get(k) is not None
        ]
        if prices != sorted(prices):
            problems.append(f"{r['id']}: prices out of order.")
        tol = LIST_TOLERANCE if r["kw_source"] == "list" else LIST_TOLERANCE_MASTR
        if r.get("awarded_kw") and abs(r["list_kw"] / r["awarded_kw"] - 1) > tol:
            problems.append(
                f"{r['id']}: award list {r['list_kw']:.0f} kW vs page {r['awarded_kw']} kW."
            )
        if not r["turbines"] or r["turbines_in_mastr"] / r["turbines"] < MIN_LINKED:
            problems.append(
                f"{r['id']}: only {r['turbines_in_mastr']}/{r['turbines']} turbines found in MaStR."
            )
        if r["yield_share"] < MIN_YIELD_SHARE:
            problems.append(
                f"{r['id']}: yield estimate for only {r['yield_share']:.0%} of the capacity."
            )
        if r["full_load_hours_avg"] is not None and not 1500 <= r["full_load_hours_avg"] <= 4500:
            problems.append(
                f"{r['id']}: average full-load hours {r['full_load_hours_avg']} implausible."
            )
        if abs(sum(r["kw_by_category"].values()) - r["list_kw"]) > 1:
            problems.append(f"{r['id']}: categories do not add up.")
    for e in onshore.get("company_reported", []):
        if not str(e.get("source", "")).startswith("http"):
            problems.append(f"company_reported {e['group']} {e['round']}: no source.")
    if any(a["attribution"] == "reviewed" and not a["group"] for a in awards):
        problems.append("awards.json: reviewed award without a group.")
    if len(awards) != sum(r["list_awards"] for r in onshore["rounds"]):
        problems.append("awards.json: row count differs from the rounds.")
    if any(a["bidder"] is None and a["lat"] is not None for a in awards):
        problems.append("awards.json: location shown for a bidder without a company name.")
    if problems:
        raise AuctionCheckError("; ".join(problems))
