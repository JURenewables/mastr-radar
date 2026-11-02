"""Station 2 for the grid APIs (contract v1.8 draft): Netztransparenz redispatch
CSVs → data/extract/redispatch.parquet; ENTSO-E flow JSON → flows.parquet.
German column names and values are mapped to English here (config/columns.yaml)."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from mastr_radar.extract import load_columns_config
from mastr_radar.gridapis import read_redispatch

REDISPATCH_SCHEMA = pa.schema(
    [
        ("start", pa.timestamp("ms", tz="UTC")),
        ("end", pa.timestamp("ms", tz="UTC")),
        ("reason", pa.string()),
        ("category", pa.string()),
        ("direction", pa.string()),
        ("mw_avg", pa.float64()),
        ("mw_max", pa.float64()),
        ("mwh", pa.float64()),
        ("tso", pa.string()),
        ("requesting_tso", pa.string()),
        ("asset", pa.string()),
        ("asset_is_substation", pa.bool_()),
        ("energy", pa.string()),
    ]
)
FLOWS_SCHEMA = pa.schema(
    [
        ("time", pa.timestamp("ms", tz="UTC")),
        ("neighbour", pa.string()),
        ("import_mw", pa.float64()),
        ("export_mw", pa.float64()),
    ]
)


class GridExtractError(Exception):
    """Raised when the grid extract breaks its contract."""


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(
        s.str.replace(".", "", regex=False).str.replace(",", ".", regex=False), errors="coerce"
    )


def extract_redispatch(cache_dir: Path, out_path: Path, cfg: dict | None = None) -> int:
    rc = (cfg or load_columns_config())["redispatch"]
    raw = read_redispatch(cache_dir)
    if raw.empty:
        raise GridExtractError("No redispatch data in the cache; run grid-fetch first.")
    df = raw.rename(columns=rc["columns"])
    ts = lambda d, t: pd.to_datetime(df[d] + " " + df[t], format="%d.%m.%Y %H:%M", utc=True)  # noqa: E731
    reason = df["reason"].fillna("")
    cat = pd.Series("other", index=df.index)
    for rule in reversed(rc["reason_categories"]):  # first rule wins
        cat[reason.str.contains(rule["match"], regex=False)] = rule["category"]
    out = pd.DataFrame(
        {
            "start": ts("start_date", "start_time"),
            "end": ts("end_date", "end_time"),
            "reason": reason,
            "category": cat,
            "direction": df["direction"].map(rc["direction_values"]),
            "mw_avg": _num(df["mw_avg"].astype(str)),
            "mw_max": _num(df["mw_max"].astype(str)),
            "mwh": _num(df["mwh"].astype(str)),
            "tso": df["tso"],
            "requesting_tso": df["requesting_tso"],
            "asset": df["asset"],
            "asset_is_substation": df["asset"].fillna("").str.startswith(rc["substation_prefix"]),
            "energy": df["energy"].map(rc["energy_values"]),
        }
    ).drop_duplicates()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.Table.from_pandas(out, REDISPATCH_SCHEMA, preserve_index=False),
        out_path,
        compression="zstd",
    )
    return len(out)


def extract_flows(cache_dir: Path, out_path: Path) -> int:
    rows = []
    for p in sorted(cache_dir.glob("flows_*.json")):
        code = p.stem.split("_")[1]
        d = json.loads(p.read_text("utf-8"))
        imp = dict(d.get("import", []))
        exp = dict(d.get("export", []))
        for t in sorted(set(imp) | set(exp)):
            rows.append((t, code, imp.get(t, 0.0), exp.get(t, 0.0)))
    if not rows:
        raise GridExtractError("No flow data in the cache; run grid-fetch first.")
    df = pd.DataFrame(rows, columns=["time", "neighbour", "import_mw", "export_mw"])
    df["time"] = pd.to_datetime(df["time"], utc=True)
    # Hourly means, so 15-minute and hourly series line up.
    df = (
        df.set_index("time")
        .groupby("neighbour")
        .resample("1h")[["import_mw", "export_mw"]]
        .mean()
        .reset_index()
    )
    df = df.dropna(subset=["import_mw", "export_mw"], how="all").fillna(0.0)[
        ["time", "neighbour", "import_mw", "export_mw"]
    ]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.Table.from_pandas(df, FLOWS_SCHEMA, preserve_index=False), out_path, compression="zstd"
    )
    return len(df)


def check(redispatch_path: Path, flows_path: Path | None) -> None:
    problems = []
    t = pq.read_table(redispatch_path)
    if t.schema.remove_metadata() != REDISPATCH_SCHEMA:
        problems.append("redispatch.parquet: columns differ from the contract.")
    df = t.to_pandas()
    if len(df) < 1000:
        problems.append(f"redispatch.parquet: only {len(df)} measures.")
    if df["direction"].isna().mean() > 0.01:
        problems.append("redispatch.parquet: unknown direction values (check the mapping).")
    if df["energy"].isna().mean() > 0.05:
        problems.append("redispatch.parquet: unknown energy values (check the mapping).")
    if (df["mwh"] < 0).any():
        problems.append("redispatch.parquet: negative MWh.")
    if flows_path is not None and flows_path.exists():
        f = pq.read_table(flows_path)
        if f.schema.remove_metadata() != FLOWS_SCHEMA:
            problems.append("flows.parquet: columns differ from the contract.")
        fd = f.to_pandas()
        if fd["neighbour"].nunique() < 8:
            problems.append(f"flows.parquet: only {fd['neighbour'].nunique()} neighbours.")
        if ((fd["import_mw"] < 0) | (fd["export_mw"] < 0)).any():
            problems.append("flows.parquet: negative flows.")
    if problems:
        raise GridExtractError("; ".join(problems))
