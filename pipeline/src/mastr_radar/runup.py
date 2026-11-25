"""Registration run-up before auction bid dates (contract v1.9) →
auctions/runup.json (station 3).

Wind: for every awarded turbine linked to MaStR, when its permit and the unit
itself were registered, in days relative to the bid date; plus all wind permit
registrations per week. Solar: when awarded parks first appear in MaStR
relative to the bid date; plus large ground-mounted registrations per week.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from mastr_radar import auctions as wa
from mastr_radar.solar_auctions import norm_award

FILE = "auctions/runup.json"
FIRST_WEEK = "2019-01-07"
WINDOW = (-365, 365)  # days around the bid date kept per award


class RunupCheckError(Exception):
    """Raised when runup.json breaks the contract."""


def _days(a: pd.Series, b: pd.Timestamp) -> pd.Series:
    return (pd.to_datetime(a) - b).dt.days


def _weekly(dates: pd.Series, kw: pd.Series, until: date) -> dict:
    d = pd.DataFrame({"week": pd.to_datetime(dates).dt.to_period("W-SUN").dt.start_time, "kw": kw})
    d = d[(d["week"] >= FIRST_WEEK) & (d["week"] <= pd.Timestamp(until))]
    g = d.groupby("week").agg(units=("kw", "size"), kw=("kw", "sum"))
    weeks = pd.date_range(FIRST_WEEK, pd.Timestamp(until), freq="W-MON")
    g = g.reindex(weeks, fill_value=0)
    return {
        "weeks": [w.date().isoformat() for w in g.index],
        "units": [int(x) for x in g["units"]],
        "mw": [round(float(x) / 1000, 1) for x in g["kw"]],
    }


def _summary(offsets: list[int]) -> dict:
    s = pd.Series(offsets, dtype=float)
    before = s[s <= 0]
    return {
        "n": int(len(s)),
        "median_days": None if s.empty else int(s.median()),
        "share_before_bid": None if s.empty else round(float((s <= 0).mean()), 3),
        "share_last_8_weeks": None
        if before.empty
        else round(float(((s > -56) & (s <= 0)).mean()), 3),
    }


def build_wind(rounds: list[dict], cache_dir: Path, extract_dir: Path, as_of: date) -> dict:
    units = pq.read_table(
        extract_dir / "units.parquet",
        columns=["unit_id", "eeg_id", "technology", "registration_date", "capacity_kw"],
    ).to_pandas()
    units = units[units["technology"] == "wind_onshore"]
    det = pq.read_table(
        extract_dir / "unit_details.parquet", columns=["unit_id", "permit_registered"]
    ).to_pandas()
    u = units.merge(det, on="unit_id", how="left").set_index("unit_id")
    key = {**dict(zip(u.index, u.index, strict=True))}
    key.update({e: i for e, i in zip(units["eeg_id"], units["unit_id"], strict=True) if e})
    out_rounds = []
    deadlines: list[tuple[str, pd.Timestamp]] = []  # (bid date, permit deadline) of earlier rounds
    awarded_in: dict[str, set[str]] = {}
    pages = [
        (rnd, wa.parse_round_page((cache_dir / f"{rnd['id']}.html").read_text(encoding="utf-8")))
        for rnd in rounds
    ]
    for rnd, page in sorted((x for x in pages if x[1]["bid_date"]), key=lambda x: x[1]["bid_date"]):
        bid = pd.Timestamp(page["bid_date"])
        awards = wa.parse_award_list(cache_dir / f"{rnd['id']}.xlsx")
        ids = sorted({key[r] for a in awards for r in a["turbines"] if r in key})
        for i in ids:
            awarded_in.setdefault(i, set()).add(page["bid_date"])
        x = u.loc[ids]
        # Earlier rounds whose permit deadline this turbine's permit already met.
        earlier = None
        if page["permit_deadline"]:
            reg = pd.to_datetime(x["permit_registered"]).dropna()
            prior = [d for b, d in deadlines if b < page["bid_date"]]
            n_prior = [sum(1 for d in prior if r <= d) for r in reg]
            earlier = {
                "n": len(n_prior),
                "share_1plus": round(sum(v >= 1 for v in n_prior) / len(n_prior), 3)
                if n_prior
                else None,
                "share_2plus": round(sum(v >= 2 for v in n_prior) / len(n_prior), 3)
                if n_prior
                else None,
            }
            deadlines.append((page["bid_date"], pd.Timestamp(page["permit_deadline"])))
        permit = _days(x["permit_registered"], bid).dropna()
        unit = _days(x["registration_date"], bid).dropna()
        clip = lambda s: [int(v) for v in s if WINDOW[0] <= v <= WINDOW[1]]  # noqa: E731
        out_rounds.append(
            {
                "id": rnd["id"],
                "bid_date": page["bid_date"],
                "permit_deadline": page["permit_deadline"],
                "deadline_days": None
                if not page["permit_deadline"]
                else int((pd.Timestamp(page["permit_deadline"]) - bid).days),
                "turbines": len(ids),
                "permit_days": clip(permit),
                "unit_days": clip(unit),
                "permit": _summary(list(permit)),
                "unit": _summary(list(unit)),
                "eligible_earlier": earlier,
            }
        )
    with_permit = u[u["permit_registered"].notna()]
    return {
        "rounds": out_rounds,
        "awarded_turbines": len(awarded_in),
        "reawarded_turbines": sum(1 for v in awarded_in.values() if len(v) > 1),
        "weekly_permits": _weekly(
            with_permit["permit_registered"], with_permit["capacity_kw"], as_of
        ),
    }


def build_solar(out_dir: Path, extract_dir: Path, as_of: date) -> dict:
    awards = json.loads((out_dir / "auctions" / "solar_awards.json").read_text())["awards"]
    det = pq.read_table(
        extract_dir / "unit_details.parquet",
        columns=["unit_id", "technology", "award_no", "solar_kind"],
    ).to_pandas()
    det = det[det["technology"] == "solar"]
    units = pq.read_table(
        extract_dir / "units.parquet", columns=["unit_id", "registration_date", "capacity_kw"]
    ).to_pandas()
    det = det.merge(units, on="unit_id", how="left")
    det["awn"] = det["award_no"].map(norm_award)
    first_reg = det.dropna(subset=["awn"]).groupby("awn")["registration_date"].min()
    by_round: dict[str, dict] = {}
    for a in awards:
        if a["programme"] != "solar":
            continue
        r = by_round.setdefault(
            a["round"], {"id": a["round"], "bid_date": a["bid_date"], "days": [], "awards": 0}
        )
        r["awards"] += 1
        reg = first_reg.get(norm_award(a["award_no"]))
        if reg is not None and not pd.isna(reg):
            d = int((pd.Timestamp(reg) - pd.Timestamp(a["bid_date"])).days)
            if WINDOW[0] <= d <= 3 * WINDOW[1]:
                r["days"].append(d)
    rounds = []
    for r in sorted(by_round.values(), key=lambda r: r["bid_date"]):
        rounds.append(
            {
                **{k: r[k] for k in ("id", "bid_date", "awards")},
                "unit_days": r["days"],
                "unit": _summary(r["days"]),
            }
        )
    ground = det[
        det["solar_kind"].fillna("").str.contains("Freifläche") & (det["capacity_kw"] >= 750)
    ]
    return {
        "rounds": rounds,
        "weekly_ground_mounted": _weekly(ground["registration_date"], ground["capacity_kw"], as_of),
    }


def build(
    rounds: list[dict], cache_dir: Path, extract_dir: Path, out_dir: Path, as_of: date
) -> list[dict]:
    data = {"as_of": as_of.isoformat(), "wind": build_wind(rounds, cache_dir, extract_dir, as_of)}
    if (out_dir / "auctions" / "solar_awards.json").exists():
        data["solar"] = build_solar(out_dir, extract_dir, as_of)
    check_data(data)
    (out_dir / FILE).write_text(json.dumps(data, separators=(",", ":")))
    return [
        {
            "name": FILE,
            "rows": len(data["wind"]["rounds"]),
            "bytes": (out_dir / FILE).stat().st_size,
        }
    ]


def check(out_dir: Path) -> None:
    check_data(json.loads((out_dir / FILE).read_text()))


def check_data(d: dict) -> None:
    problems = []
    w = d["wind"]
    if len(w["rounds"]) < 10:
        problems.append(f"wind: only {len(w['rounds'])} rounds.")
    linked = sum(r["permit"]["n"] for r in w["rounds"])
    if linked < 1000:
        problems.append(f"wind: only {linked} awarded turbines with a permit registration date.")
    wk = w["weekly_permits"]
    if not (len(wk["weeks"]) == len(wk["units"]) == len(wk["mw"])) or len(wk["weeks"]) < 100:
        problems.append("wind: weekly series broken.")
    for r in w["rounds"]:
        e = r.get("eligible_earlier")
        if e and any(
            v is not None and not 0 <= v <= 1 for v in (e["share_1plus"], e["share_2plus"])
        ):
            problems.append(f"wind {r['id']}: eligible-earlier share outside 0..1.")
    if "solar" in d and len(d["solar"]["rounds"]) < 5:
        problems.append("solar: fewer than 5 rounds.")
    if problems:
        raise RunupCheckError("Run-up check failed:\n- " + "\n- ".join(problems))
