"""Station 3: build the explorer files the website reads (contract v1.2).

manifest.json, kpis.json, units.parquet (units >= 100 kW), summary.parquet
(totals for all units) and the state/district boundaries.
"""

from __future__ import annotations

import json
import math
import shutil
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from mastr_radar import __version__
from mastr_radar.config import PIPELINE_ROOT
from mastr_radar.extract import ENUMS, UNITS_SCHEMA, export_date_of

CONTRACT_VERSION = "1.2"
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAP_POINT_MIN_KW = 100.0  # D5: units from 100 kW are individual points
DEFAULT_OPERATOR_NAME_MIN_KW = 1000.0  # operator names only from 1 MW (settings)
BOUNDARIES_DIR = PIPELINE_ROOT / "assets" / "boundaries"
BOUNDARY_FILES = ("states.geojson", "districts.geojson")

# units.parquet for the website: station 2 columns minus three the site doesn't need.
WEB_UNITS_DROP = ("eeg_id", "postcode", "last_updated")
WEB_UNITS_SCHEMA = pa.schema([f for f in UNITS_SCHEMA if f.name not in WEB_UNITS_DROP])

SUMMARY_KEYS = [
    "technology",
    "status",
    "size_class",
    "state_key",
    "district_key",
    "commissioning_month",
]
SUMMARY_SCHEMA = pa.schema(
    [(k, pa.string()) for k in SUMMARY_KEYS]
    + [("unit_count", pa.int64()), ("capacity_kw", pa.float64())]
)

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


def build_web_units(units: pa.Table, operator_name_min_kw: float) -> pa.Table:
    """Units >= 100 kW for map points and tables; operator names only from 1 MW."""
    big = units.filter(pc.greater_equal(units["capacity_kw"], MAP_POINT_MIN_KW))
    small_for_name = pc.less(big["capacity_kw"], operator_name_min_kw)
    names = pc.if_else(small_for_name, pa.scalar(None, pa.string()), big["operator_name"])
    big = big.set_column(big.schema.get_field_index("operator_name"), "operator_name", names)
    big = big.select(WEB_UNITS_SCHEMA.names).cast(WEB_UNITS_SCHEMA)
    return big.sort_by([("technology", "ascending"), ("capacity_kw", "descending")])


def build_summary(units: pa.Table) -> pa.Table:
    """Totals for all units by technology, status, size, region and commissioning month."""
    month = pc.strftime(units["commissioning_date"], format="%Y-%m")
    t = units.select(SUMMARY_KEYS[:-1] + ["capacity_kw"]).append_column(
        "commissioning_month", month
    )
    grouped = t.group_by(SUMMARY_KEYS, use_threads=False).aggregate(
        [([], "count_all"), ("capacity_kw", "sum")]
    )
    grouped = grouped.rename_columns({"count_all": "unit_count", "capacity_kw_sum": "capacity_kw"})
    return (
        grouped.select(SUMMARY_SCHEMA.names)
        .cast(SUMMARY_SCHEMA)
        .sort_by([(k, "ascending") for k in SUMMARY_KEYS])
    )


def _file_entry(out_dir: Path, name: str, rows: int) -> dict:
    return {"name": name, "rows": rows, "bytes": (out_dir / name).stat().st_size}


def build(
    units_path: Path,
    out_dir: Path,
    *,
    boundaries_dir: Path = BOUNDARIES_DIR,
    operator_name_min_kw: float = DEFAULT_OPERATOR_NAME_MIN_KW,
) -> dict:
    """Write all explorer files and manifest.json; return the manifest."""
    units = pq.read_table(units_path)
    as_of = export_date_of(units_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []

    kpis = build_kpis(units, as_of)
    _write_json(out_dir / "kpis.json", kpis)
    files.append(_file_entry(out_dir, "kpis.json", len(kpis)))

    web_units = build_web_units(units, operator_name_min_kw)
    pq.write_table(web_units, out_dir / "units.parquet", compression="zstd")
    files.append(_file_entry(out_dir, "units.parquet", web_units.num_rows))

    summary = build_summary(units)
    pq.write_table(summary, out_dir / "summary.parquet", compression="zstd")
    files.append(_file_entry(out_dir, "summary.parquet", summary.num_rows))

    (out_dir / "boundaries").mkdir(exist_ok=True)
    for name in BOUNDARY_FILES:
        shutil.copyfile(boundaries_dir / name, out_dir / "boundaries" / name)
        n = len(json.loads((out_dir / "boundaries" / name).read_text())["features"])
        files.append(_file_entry(out_dir, f"boundaries/{name}", n))

    manifest = {
        "contract_version": CONTRACT_VERSION,
        "as_of": as_of.isoformat(),
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "pipeline_version": __version__,
        "incomplete_after": incomplete_after(units, as_of),
        "files": files,
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
    expected_files = {"kpis.json", "units.parquet", "summary.parquet"} | {
        f"boundaries/{n}" for n in BOUNDARY_FILES
    }
    if missing := expected_files - set(listed):
        problems.append(f"manifest: missing files {sorted(missing)}.")
    for name in ("units.parquet", "summary.parquet"):
        path = out_dir / name
        if (
            name in listed
            and path.exists()
            and pq.read_metadata(path).num_rows != listed[name]["rows"]
        ):
            problems.append(f"manifest: wrong row count for {name}.")

    _check_web_units(out_dir, units, problems)
    _check_summary(out_dir, units, problems)
    _check_boundaries(out_dir, problems)

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


def _check_web_units(out_dir: Path, units: pa.Table, problems: list[str]) -> None:
    path = out_dir / "units.parquet"
    if not path.exists():
        return
    web = pq.read_table(path)
    if web.schema.remove_metadata() != WEB_UNITS_SCHEMA:
        problems.append("units.parquet: schema does not match contract v1.1.")
        return
    if (pc.min(web["capacity_kw"]).as_py() or MAP_POINT_MIN_KW) < MAP_POINT_MIN_KW:
        problems.append("units.parquet: contains units below 100 kW.")
    expected = pc.sum(pc.greater_equal(units["capacity_kw"], MAP_POINT_MIN_KW)).as_py() or 0
    if web.num_rows != expected:
        problems.append(f"units.parquet: {web.num_rows} rows, expected {expected}.")
    person = web["operator_is_person"]
    for col in ["name", "operator_name", "lat", "lon"]:
        if pc.sum(pc.and_(person, pc.is_valid(web[col]))).as_py():
            problems.append(f"units.parquet: PRIVACY: natural-person units have {col}.")


def _check_summary(out_dir: Path, units: pa.Table, problems: list[str]) -> None:
    path = out_dir / "summary.parquet"
    if not path.exists():
        return
    summary = pq.read_table(path)
    if summary.schema.remove_metadata() != SUMMARY_SCHEMA:
        problems.append("summary.parquet: schema does not match contract v1.1.")
        return

    # Totals match: per technology, summary equals units.parquet from station 2.
    got = {
        r["technology"]: (r["capacity_kw_sum"], r["unit_count_sum"])
        for r in summary.group_by("technology")
        .aggregate([("capacity_kw", "sum"), ("unit_count", "sum")])
        .to_pylist()
    }
    want = {
        r["technology"]: (r["capacity_kw_sum"], r["unit_id_count"])
        for r in units.group_by("technology")
        .aggregate([("capacity_kw", "sum"), ("unit_id", "count")])
        .to_pylist()
    }
    for tech, (cap, n) in want.items():
        g_cap, g_n = got.get(tech, (0.0, 0))
        if g_n != n or abs(g_cap - cap) > 1:
            problems.append(f"summary.parquet: totals for {tech} do not match units.parquet.")


def _check_boundaries(out_dir: Path, problems: list[str]) -> None:
    for name, key_len in zip(BOUNDARY_FILES, (2, 5), strict=True):
        path = out_dir / "boundaries" / name
        if not path.exists():
            problems.append(f"boundaries/{name} is missing.")
            continue
        fc = json.loads(path.read_text())
        keys = [f["properties"].get("key", "") for f in fc.get("features", [])]
        if not keys or any(len(k) != key_len for k in keys):
            problems.append(f"boundaries/{name}: missing or malformed keys.")
