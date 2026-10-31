"""Station 3: build the explorer files the website reads (contract v1.1).

WP7 builds manifest.json and kpis.json. WP11 adds units.parquet,
summary.parquet and the boundaries.
"""

from __future__ import annotations

import json
import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from mastr_radar import __version__
from mastr_radar.extract import ENUMS, export_date_of

CONTRACT_VERSION = "1.1"
MAX_TOTAL_BYTES = 25 * 1024 * 1024

# Registration delay (provisional, refined in WP12): look at units commissioned
# 6–24 months before the as-of date, so most of them have had time to register.
LAG_WINDOW_DAYS = (183, 730)
LAG_QUANTILE = 0.9
LAG_MIN_UNITS = 50
LAG_FALLBACK_DAYS = 60

KPI_FIELDS = {
    "technology": str,
    "installed_capacity_kw": float,
    "installed_units": int,
    "planned_capacity_kw": float,
    "added_capacity_kw_ytd": float,
}
MANIFEST_FIELDS = {
    "contract_version": str,
    "as_of": str,
    "generated_at": str,
    "pipeline_version": str,
    "incomplete_after": dict,
    "files": list,
}


class ExplorerCheckError(RuntimeError):
    """The explorer files do not meet the station 3 contract."""


def _sum(table: pa.Table, mask) -> float:
    return round(pc.sum(table.filter(mask)["capacity_kw"]).as_py() or 0.0, 3)


def build_kpis(units: pa.Table, as_of: date) -> list[dict]:
    year_start = pa.scalar(date(as_of.year, 1, 1), pa.date32())
    out = []
    for tech in sorted(pc.unique(units["technology"]).to_pylist()):
        t = units.filter(pc.equal(units["technology"], tech))
        operating = pc.equal(t["status"], "operating")
        out.append(
            {
                "technology": tech,
                "installed_capacity_kw": _sum(t, operating),
                "installed_units": int(pc.sum(operating).as_py() or 0),
                "planned_capacity_kw": _sum(t, pc.equal(t["status"], "planned")),
                "added_capacity_kw_ytd": _sum(
                    t, pc.fill_null(pc.greater_equal(t["commissioning_date"], year_start), False)
                ),
            }
        )
    return out


def incomplete_after(units: pa.Table, as_of: date) -> dict[str, str]:
    """Per technology: the date after which data is likely incomplete (D10)."""
    lo = pa.scalar(as_of - timedelta(days=LAG_WINDOW_DAYS[1]), pa.date32())
    hi = pa.scalar(as_of - timedelta(days=LAG_WINDOW_DAYS[0]), pa.date32())
    out = {}
    for tech in sorted(pc.unique(units["technology"]).to_pylist()):
        t = units.filter(pc.equal(units["technology"], tech))
        cod = t["commissioning_date"]
        in_window = pc.fill_null(pc.and_(pc.greater_equal(cod, lo), pc.less(cod, hi)), False)
        t = t.filter(in_window)
        lag_days = LAG_FALLBACK_DAYS
        if t.num_rows >= LAG_MIN_UNITS:
            reg = pc.cast(t["registration_date"], pa.int32())
            com = pc.cast(t["commissioning_date"], pa.int32())
            lags = pc.max_element_wise(pc.subtract(reg, com), 0)
            lag_days = math.ceil(pc.quantile(lags, q=LAG_QUANTILE)[0].as_py())
        out[tech] = (as_of - timedelta(days=lag_days)).isoformat()
    return out


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def build(units_path: Path, out_dir: Path) -> dict:
    """Write kpis.json and manifest.json; return the manifest."""
    units = pq.read_table(units_path)
    as_of = export_date_of(units_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    kpis = build_kpis(units, as_of)
    _write_json(out_dir / "kpis.json", kpis)

    manifest = {
        "contract_version": CONTRACT_VERSION,
        "as_of": as_of.isoformat(),
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "pipeline_version": __version__,
        "incomplete_after": incomplete_after(units, as_of),
        "files": [
            {
                "name": "kpis.json",
                "rows": len(kpis),
                "bytes": (out_dir / "kpis.json").stat().st_size,
            }
        ],
    }
    _write_json(out_dir / "manifest.json", manifest)
    return manifest


# --- Check -------------------------------------------------------------------


def _check_fields(obj: dict, fields: dict, where: str, problems: list[str]) -> None:
    missing = set(fields) - set(obj)
    extra = set(obj) - set(fields)
    if missing:
        problems.append(f"{where}: missing {sorted(missing)}.")
    if extra:
        problems.append(f"{where}: unexpected {sorted(extra)}.")
    for key, typ in fields.items():
        value = obj.get(key)
        ok = isinstance(value, (int, float)) if typ is float else isinstance(value, typ)
        if key in obj and (not ok or isinstance(value, bool)):
            problems.append(f"{where}.{key}: expected {typ.__name__}.")


def check_explorer_files(out_dir: Path, units_path: Path) -> None:
    """Run the station 3 check. Raises ExplorerCheckError listing every problem."""
    problems: list[str] = []
    manifest = json.loads((out_dir / "manifest.json").read_text())
    kpis = json.loads((out_dir / "kpis.json").read_text())
    units = pq.read_table(units_path)
    as_of = export_date_of(units_path)

    _check_fields(manifest, MANIFEST_FIELDS, "manifest", problems)
    if manifest.get("contract_version") != CONTRACT_VERSION:
        problems.append(f"manifest: contract_version must be {CONTRACT_VERSION!r}.")
    if manifest.get("as_of") != as_of.isoformat():
        problems.append("manifest: as_of does not match the export date.")
    for tech, day in manifest.get("incomplete_after", {}).items():
        if tech not in ENUMS["technology"]:
            problems.append(f"manifest.incomplete_after: unknown technology {tech!r}.")
        if date.fromisoformat(day) > as_of:
            problems.append(f"manifest.incomplete_after.{tech} is after as_of.")

    listed = {f["name"]: f for f in manifest.get("files", [])}
    for name, info in listed.items():
        path = out_dir / name
        if not path.exists():
            problems.append(f"manifest lists {name}, which does not exist.")
            continue
        if info["bytes"] != path.stat().st_size:
            problems.append(f"manifest: wrong size for {name}.")
    if "kpis.json" in listed and listed["kpis.json"]["rows"] != len(kpis):
        problems.append("manifest: wrong row count for kpis.json.")

    techs_in_units = set(pc.unique(units["technology"]).to_pylist())
    for i, entry in enumerate(kpis):
        _check_fields(entry, KPI_FIELDS, f"kpis[{i}]", problems)
        if entry.get("technology") not in techs_in_units:
            problems.append(f"kpis[{i}]: technology not in units.parquet.")
        for key in KPI_FIELDS:
            if key != "technology" and isinstance(entry.get(key), (int, float)) and entry[key] < 0:
                problems.append(f"kpis[{i}].{key} is negative.")
    # Totals match: installed capacity equals the operating sum in units.parquet.
    expected = {k["technology"]: k for k in build_kpis(units, as_of)}
    for entry in kpis:
        exp = expected.get(entry.get("technology"))
        if exp and abs(exp["installed_capacity_kw"] - entry["installed_capacity_kw"]) > 1:
            problems.append(f"kpis: installed capacity of {entry['technology']} does not match.")

    total = sum(p.stat().st_size for p in out_dir.rglob("*") if p.is_file())
    if total > MAX_TOTAL_BYTES:
        problems.append(f"{out_dir} is {total:,} bytes, over the 25 MB budget.")

    if problems:
        raise ExplorerCheckError("; ".join(problems))
