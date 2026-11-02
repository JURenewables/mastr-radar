"""Station 3 for the grid APIs (contract v1.8): redispatch.parquet →
grid/redispatch.json; flows.parquet → grid/flows.json. Only aggregates are
published (Netztransparenz data is not redistributed row by row)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd

REDISPATCH_FILE = "grid/redispatch.json"
FLOWS_FILE = "grid/flows.json"
ENERGIES = ("conventional", "renewable", "other")


class RedispatchCheckError(Exception):
    """Raised when the redispatch or flow files break the contract."""


def _r(x: float) -> int:
    return int(round(float(x)))


def build_redispatch(extract_dir: Path, out_dir: Path, as_of: date) -> dict:
    df = pd.read_parquet(extract_dir / "redispatch.parquet")
    df["month"] = df["start"].dt.strftime("%Y-%m")
    df["year"] = df["start"].dt.year.astype(str)
    rd = df[df["category"] != "test"]
    months = sorted(rd["month"].unique())
    monthly = []
    for m in months:
        x = rd[rd["month"] == m]
        row = {
            "month": m,
            "countertrade_mwh": _r(x.loc[x["category"] == "countertrade", "mwh"].sum()),
        }
        for d in ("down", "up"):
            y = x[(x["direction"] == d) & (x["category"] != "countertrade")]
            row[f"{d}_mwh"] = {e: _r(y.loc[y["energy"] == e, "mwh"].sum()) for e in ENERGIES}
        monthly.append(row)
    years = sorted(rd["year"].unique())
    by_tso = {
        t: {
            y: _r(
                rd[(rd["tso"] == t) & (rd["year"] == y) & (rd["direction"] == "down")]["mwh"].sum()
            )
            for y in years
        }
        for t in sorted(rd["tso"].dropna().unique())
    }
    reasons = rd.groupby("category")["mwh"].sum()
    last12 = rd[rd["start"] >= rd["start"].max() - pd.Timedelta(days=365)]

    def top(sub: pd.DataFrame, n: int = 15) -> list[dict]:
        g = sub.groupby("asset").agg(
            mwh=("mwh", "sum"), measures=("mwh", "size"), tso=("tso", lambda s: s.mode().iat[0])
        )
        g = g.sort_values("mwh", ascending=False).head(n)
        return [
            {"asset": a, "mwh": _r(r.mwh), "measures": int(r.measures), "tso": r.tso}
            for a, r in g.iterrows()
        ]

    down12 = last12[(last12["direction"] == "down") & (last12["category"] != "countertrade")]
    up12 = last12[(last12["direction"] == "up") & (last12["category"] != "countertrade")]
    out = {
        "as_of": as_of.isoformat(),
        "first": df["start"].min().date().isoformat(),
        "last": df["start"].max().date().isoformat(),
        "monthly": monthly,
        "by_tso_down_mwh": by_tso,
        "category_mwh": {k: _r(v) for k, v in reasons.items()},
        "last_12m": {
            "down_mwh": {e: _r(down12.loc[down12["energy"] == e, "mwh"].sum()) for e in ENERGIES},
            "up_mwh": {e: _r(up12.loc[up12["energy"] == e, "mwh"].sum()) for e in ENERGIES},
            "countertrade_mwh": _r(last12.loc[last12["category"] == "countertrade", "mwh"].sum()),
            "measures": int(len(last12)),
            "renewable_substations": top(
                down12[down12["asset_is_substation"] & (down12["energy"] == "renewable")]
            ),
            "reduced_plants": top(
                down12[~down12["asset_is_substation"] & (down12["energy"] == "conventional")]
            ),
            "increased_plants": top(up12[up12["energy"] == "conventional"]),
        },
    }
    check_redispatch(out)
    return out


def build_flows(extract_dir: Path, as_of: date) -> dict:
    df = pd.read_parquet(extract_dir / "flows.parquet")
    df["net_import_mw"] = df["import_mw"] - df["export_mw"]
    df["month"] = df["time"].dt.strftime("%Y-%m")
    months = sorted(df["month"].unique())
    codes = sorted(df["neighbour"].unique())
    piv = (
        df.groupby(["month", "neighbour"])["net_import_mw"].sum().unstack(fill_value=0) / 1000
    )  # MWh→GWh (hourly MW)
    last = df[df["time"] >= df["time"].max() - pd.Timedelta(days=365)]
    tot = last.groupby("neighbour")[["import_mw", "export_mw"]].sum() / 1000
    hourly = (
        last.groupby([last["time"].dt.hour, "time"])["net_import_mw"].sum().groupby(level=0).mean()
    )
    out = {
        "as_of": as_of.isoformat(),
        "first": df["time"].min().date().isoformat(),
        "last": df["time"].max().date().isoformat(),
        "neighbours": codes,
        "monthly_net_import_gwh": {m: {c: _r(piv.loc[m].get(c, 0)) for c in codes} for m in months},
        "last_12m": {
            c: {
                "import_gwh": _r(tot.loc[c, "import_mw"]),
                "export_gwh": _r(tot.loc[c, "export_mw"]),
            }
            for c in tot.index
        },
        "net_import_by_hour_utc_mw": [_r(hourly.get(h, 0)) for h in range(24)],
    }
    check_flows(out)
    return out


def build(extract_dir: Path, out_dir: Path, as_of: date) -> list[dict]:
    files = []
    folder = out_dir / "grid"
    folder.mkdir(parents=True, exist_ok=True)
    if (extract_dir / "redispatch.parquet").exists():
        data = build_redispatch(extract_dir, out_dir, as_of)
        (out_dir / REDISPATCH_FILE).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        )
        files.append(
            {
                "name": REDISPATCH_FILE,
                "rows": len(data["monthly"]),
                "bytes": (out_dir / REDISPATCH_FILE).stat().st_size,
            }
        )
    if (extract_dir / "flows.parquet").exists():
        data = build_flows(extract_dir, as_of)
        (out_dir / FLOWS_FILE).write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        )
        files.append(
            {
                "name": FLOWS_FILE,
                "rows": len(data["monthly_net_import_gwh"]),
                "bytes": (out_dir / FLOWS_FILE).stat().st_size,
            }
        )
    return files


def check(out_dir: Path) -> None:
    if (out_dir / REDISPATCH_FILE).exists():
        check_redispatch(json.loads((out_dir / REDISPATCH_FILE).read_text()))
    if (out_dir / FLOWS_FILE).exists():
        check_flows(json.loads((out_dir / FLOWS_FILE).read_text()))


def check_redispatch(d: dict) -> None:
    problems = []
    if len(d["monthly"]) < 12:
        problems.append(f"redispatch: only {len(d['monthly'])} months.")
    if [m["month"] for m in d["monthly"]] != sorted(m["month"] for m in d["monthly"]):
        problems.append("redispatch: months out of order.")
    for m in d["monthly"]:
        if (
            min(list(m["down_mwh"].values()) + list(m["up_mwh"].values()) + [m["countertrade_mwh"]])
            < 0
        ):
            problems.append(f"redispatch {m['month']}: negative MWh.")
    if sum(d["last_12m"]["down_mwh"].values()) <= 0:
        problems.append("redispatch: no reductions in the last 12 months.")
    if problems:
        raise RedispatchCheckError("; ".join(problems))


def check_flows(d: dict) -> None:
    problems = []
    if len(d["neighbours"]) < 8:
        problems.append(f"flows: only {len(d['neighbours'])} neighbours.")
    if len(d["net_import_by_hour_utc_mw"]) != 24:
        problems.append("flows: hourly profile must have 24 values.")
    for c, v in d["last_12m"].items():
        if v["import_gwh"] < 0 or v["export_gwh"] < 0:
            problems.append(f"flows {c}: negative totals.")
    if problems:
        raise RedispatchCheckError("; ".join(problems))
