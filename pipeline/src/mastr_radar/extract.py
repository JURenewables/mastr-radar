"""Station 2: read the export zip into units.parquet (contract v1.1).

German source names come only from config/columns.yaml. Records are streamed
and written in batches, so memory stays flat even for 6.6 M solar units.
"""

from __future__ import annotations

import fnmatch
import json
import logging
import re
import unicodedata
import zipfile
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from xml.etree.ElementTree import iterparse

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import yaml

from mastr_radar.config import PIPELINE_ROOT

log = logging.getLogger(__name__)

COLUMNS_CONFIG = PIPELINE_ROOT / "config" / "columns.yaml"
BATCH_ROWS = 200_000
MIN_DATE = date(1890, 1, 1)
LAT_RANGE, LON_RANGE = (47.0, 56.0), (5.5, 15.5)
OUTLIER_KW = 2_000_000  # 2 000 MW

# --- Contract v1.1: the units.parquet schema ---------------------------------

UNITS_SCHEMA = pa.schema(
    [
        ("unit_id", pa.string()),
        ("technology", pa.string()),
        ("status", pa.string()),
        ("name", pa.string()),
        ("eeg_id", pa.string()),
        ("capacity_kw", pa.float64()),
        ("net_capacity_kw", pa.float64()),
        ("size_class", pa.string()),
        ("commissioning_date", pa.date32()),
        ("planned_commissioning_date", pa.date32()),
        ("registration_date", pa.date32()),
        ("shutdown_date", pa.date32()),
        ("last_updated", pa.date32()),
        ("state", pa.string()),
        ("district", pa.string()),
        ("municipality", pa.string()),
        ("municipality_key", pa.string()),
        ("district_key", pa.string()),
        ("state_key", pa.string()),
        ("postcode", pa.string()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("operator_id", pa.string()),
        ("operator_name", pa.string()),
        ("operator_is_person", pa.bool_()),
        ("manufacturer", pa.string()),
        ("turbine_model", pa.string()),
        ("hub_height_m", pa.float64()),
        ("rotor_diameter_m", pa.float64()),
        ("wind_park", pa.string()),
        ("solar_type", pa.string()),
        ("storage_technology", pa.string()),
        ("storage_capacity_kwh", pa.float64()),
        ("battery_technology", pa.string()),
        ("fuel", pa.string()),
        ("hydro_type", pa.string()),
    ]
)

REQUIRED = [
    "unit_id",
    "technology",
    "status",
    "capacity_kw",
    "size_class",
    "registration_date",
    "last_updated",
    "operator_is_person",
]

# D6. Upper bounds in kW (exclusive) and labels, as written in the contract.
SIZE_CLASSES = [
    (10, "<10 kW"),
    (100, "10–100 kW"),
    (1_000, "100 kW–1 MW"),
    (10_000, "1–10 MW"),
    (float("inf"), "≥10 MW"),
]

ENUMS = {
    "technology": {"wind_onshore", "wind_offshore", "solar", "storage", "biomass", "hydro"},
    "status": {"operating", "planned", "temporarily_shut_down", "permanently_shut_down"},
    "size_class": {label for _, label in SIZE_CLASSES},
    "solar_type": {"ground_mounted", "rooftop", "balcony", "other"},
    "storage_technology": {"battery", "pumped_hydro", "other"},
}

AGS_RE = re.compile(r"^\d{8}$")


class UnitsCheckError(RuntimeError):
    """units.parquet does not meet the station 2 contract."""


@dataclass
class Report:
    export_date: str = ""
    rows: Counter = field(default_factory=Counter)  # per technology
    skipped_inactive: int = 0
    nulled_coords: int = 0
    nulled_dates: int = 0
    invalid_ags: int = 0
    missing_sea_region: int = 0
    privacy_blanked: int = 0
    unknown_operator: int = 0
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        d["rows"] = dict(self.rows)
        return d


# --- Reading the zip ---------------------------------------------------------


def load_columns_config(path: Path = COLUMNS_CONFIG) -> dict:
    return yaml.safe_load(path.read_text())


def iter_records(zf: zipfile.ZipFile, pattern: str, record_tag: str) -> Iterator[dict]:
    """Yield each record as {tag: text} from every zip member matching `pattern`."""
    names = sorted(fnmatch.filter(zf.namelist(), pattern))
    if not names:
        raise UnitsCheckError(f"No file matching {pattern!r} in the export.")
    for name in names:
        context = iterparse(zf.open(name), events=("start", "end"))
        _, root = next(context)
        for event, el in context:
            if event == "end" and el.tag == record_tag:
                yield {child.tag: child.text for child in el}
                root.clear()  # free parsed records


def read_catalog(zf: zipfile.ZipFile) -> dict[str, str]:
    return {r["Id"]: r["Wert"] for r in iter_records(zf, "Katalogwerte.xml", "Katalogwert")}


def read_operators(
    zf: zipfile.ZipFile, cfg: dict, catalog: dict[str, str], wanted: set[str] | None = None
) -> dict[str, tuple[str | None, bool]]:
    """Map operator id → (company name, is natural person)."""
    oc = cfg["operators"]
    out = {}
    for r in iter_records(zf, oc["files"], oc["record"]):
        op_id = r.get(oc["id"])
        if wanted is not None and op_id not in wanted:
            continue
        kind = catalog.get(r.get(oc["person_type"]) or "", "")
        is_person = kind.startswith(oc["person_value_prefix"])
        out[op_id] = (None if is_person else _text(r.get(oc["name"])), is_person)
    return out


# --- Transforming one record -------------------------------------------------


def _get(rec: dict, source) -> str | None:
    for name in [source] if isinstance(source, str) else source:
        value = rec.get(name)
        if value not in (None, ""):
            return value
    return None


def _text(value: str | None) -> str | None:
    """Normalise odd Unicode in names, e.g. the full-width ampersand '＆' → '&'."""
    return unicodedata.normalize("NFKC", value).strip() if value else value


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def _date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def size_class(capacity_kw: float | None) -> str | None:
    if capacity_kw is None:
        return None
    for upper, label in SIZE_CLASSES:
        if capacity_kw < upper:
            return label
    return None


class Transformer:
    """Turns one raw record into one contract row, counting every fix in the report."""

    def __init__(self, cfg, src_cfg, catalog, operators, export_date: date, report: Report):
        self.cfg, self.src, self.catalog = cfg, src_cfg, catalog
        self.operators, self.export_date, self.report = operators, export_date, report
        self.catalog_fields = set(cfg["catalog_fields"])

    def raw(self, rec: dict, source) -> str | None:
        value = _get(rec, source)
        names = [source] if isinstance(source, str) else source
        if value is not None and any(n in self.catalog_fields for n in names):
            return self.catalog.get(value, value)
        return value

    def checked_date(self, rec, source, *, future_ok=False) -> date | None:
        raw = _get(rec, source)
        d = _date(raw)
        if raw and d is None:
            self.report.nulled_dates += 1
        if d is not None and (d < MIN_DATE or (not future_ok and d > self.export_date)):
            self.report.nulled_dates += 1
            return None
        return d

    def __call__(self, rec: dict) -> dict | None:
        c, rep = self.cfg["common"], self.report
        if self.raw(rec, c["system_status"]) != self.cfg["active_system_status"]:
            rep.skipped_inactive += 1
            return None

        row = dict.fromkeys(UNITS_SCHEMA.names)
        tech_raw = (
            self.raw(rec, self.src["technology_field"]) if "technology_field" in self.src else None
        )
        technology = self.src.get("technology_values", {}).get(
            tech_raw, self.src.get("technology", tech_raw)
        )
        status_raw = self.raw(rec, c["status"])
        capacity = _float(_get(rec, c["capacity_kw"]))

        row.update(
            unit_id=_get(rec, c["unit_id"]),
            technology=technology,
            status=self.cfg["status"].get(status_raw, status_raw),
            name=_text(_get(rec, c["name"])),
            eeg_id=_get(rec, c["eeg_id"]),
            capacity_kw=capacity,
            net_capacity_kw=_float(_get(rec, c["net_capacity_kw"])),
            size_class=size_class(capacity),
            commissioning_date=self.checked_date(rec, c["commissioning_date"]),
            planned_commissioning_date=self.checked_date(
                rec, c["planned_commissioning_date"], future_ok=True
            ),
            registration_date=self.checked_date(rec, c["registration_date"]),
            shutdown_date=self.checked_date(rec, c["shutdown_date"]),
            last_updated=self.checked_date(rec, c["last_updated"]),
            operator_id=_get(rec, c["operator_id"]),
        )

        # Location
        if technology == "wind_offshore":
            region = self.src["sea_regions"].get(self.raw(rec, self.src["sea_field"]))
            if region:
                row.update(
                    state=region["name"], state_key=region["key"], district_key=region["key"]
                )
            else:
                rep.missing_sea_region += 1
        else:
            ags = _get(rec, c["municipality_key"])
            row.update(
                state=self.raw(rec, c["state"]),
                district=_get(rec, c["district"]),
                municipality=_get(rec, c["municipality"]),
                postcode=_get(rec, c["postcode"]),
            )
            if ags and AGS_RE.match(ags):
                row.update(municipality_key=ags, district_key=ags[:5], state_key=ags[:2])
            elif ags:
                rep.invalid_ags += 1

        lat, lon = _float(_get(rec, c["lat"])), _float(_get(rec, c["lon"]))
        if lat is not None and lon is not None:
            if LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]:
                row.update(lat=lat, lon=lon)
            else:
                rep.nulled_coords += 1

        # Operator and privacy (D4). Unknown operators are treated as persons.
        op_name, is_person = self.operators.get(row["operator_id"], (None, True))
        if row["operator_id"] not in self.operators:
            rep.unknown_operator += 1
        row.update(operator_name=op_name, operator_is_person=is_person)
        if is_person:
            if row["name"] or row["lat"] is not None:
                rep.privacy_blanked += 1
            row.update(name=None, operator_name=None, lat=None, lon=None)

        # Technology details
        for col, source in self.src.get("details", {}).items():
            value = self.raw(rec, source)
            is_float = UNITS_SCHEMA.field(col).type == pa.float64()
            row[col] = _float(value) if is_float else _text(value)
        return row


# --- Running station 2 -------------------------------------------------------


def extract(
    zip_path: Path,
    out_path: Path,
    *,
    export_date: date,
    sources: tuple[str, ...] = ("wind",),
    cfg: dict | None = None,
) -> Report:
    """Write units.parquet for the given source types and return the report."""
    cfg = cfg or load_columns_config()
    report = Report(export_date=export_date.isoformat())
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_name(out_path.name + ".tmp")

    with zipfile.ZipFile(zip_path) as zf:
        catalog = read_catalog(zf)
        log.info("Catalogue: %d values", len(catalog))
        operators = read_operators(zf, cfg, catalog)
        log.info("Operators: %d", len(operators))
        # The export date travels inside the file, for station 3 (manifest as_of).
        file_schema = UNITS_SCHEMA.with_metadata({"export_date": export_date.isoformat()})
        writer = pq.ParquetWriter(tmp, file_schema, compression="zstd")
        try:
            for source in sources:
                src_cfg = cfg["sources"][source]
                transform = Transformer(cfg, src_cfg, catalog, operators, export_date, report)
                batch: list[dict] = []
                for rec in iter_records(zf, src_cfg["files"], src_cfg["record"]):
                    row = transform(rec)
                    if row is None:
                        continue
                    report.rows[row["technology"]] += 1
                    batch.append(row)
                    if len(batch) >= BATCH_ROWS:
                        writer.write_table(pa.Table.from_pylist(batch, UNITS_SCHEMA))
                        batch.clear()
                if batch:
                    writer.write_table(pa.Table.from_pylist(batch, UNITS_SCHEMA))
                log.info("%s: done (%s)", source, dict(report.rows))
        finally:
            writer.close()
    tmp.replace(out_path)
    return report


def check_units(
    table: pa.Table,
    *,
    export_date: date,
    min_rows: dict[str, int],
    report: Report | None = None,
    previous_rows: dict[str, int] | None = None,
) -> list[str]:
    """Run the station 2 check. Raises UnitsCheckError; returns warnings."""
    problems: list[str] = []
    warnings: list[str] = []

    if table.schema != UNITS_SCHEMA:
        problems.append("Schema does not match contract v1.1.")
        raise UnitsCheckError("; ".join(problems))

    ids = table["unit_id"]
    if pc.count_distinct(ids).as_py() != table.num_rows:
        problems.append("unit_id is not unique.")
    for col in REQUIRED:
        nulls = table[col].null_count
        if nulls:
            problems.append(f"{col}: {nulls} empty values (required).")
    for col, allowed in ENUMS.items():
        values = {v for v in pc.unique(table[col]).to_pylist() if v is not None}
        bad = values - allowed
        if bad:
            problems.append(f"{col}: invalid values {sorted(bad)[:5]}.")

    for source, minimum in min_rows.items():
        techs = {"wind": ["wind_onshore", "wind_offshore"]}.get(source, [source])
        n = pc.sum(pc.is_in(table["technology"], pa.array(techs))).as_py() or 0
        if n < minimum:
            problems.append(f"{source}: {n:,} rows, expected at least {minimum:,}.")

    cap = table["capacity_kw"]
    if (pc.min(cap).as_py() or 0) < 0:
        problems.append("capacity_kw has negative values.")
    n_out = pc.sum(pc.greater(cap, OUTLIER_KW)).as_py() or 0
    if n_out:
        warnings.append(f"{n_out} units above 2 000 MW (outliers).")

    for col in ["commissioning_date", "registration_date", "shutdown_date", "last_updated"]:
        lo, hi = pc.min(table[col]).as_py(), pc.max(table[col]).as_py()
        if (lo and lo < MIN_DATE) or (hi and hi > export_date):
            problems.append(f"{col} outside 1890..{export_date}.")
    lo = pc.min(table["planned_commissioning_date"]).as_py()
    if lo and lo < MIN_DATE:
        problems.append("planned_commissioning_date before 1890.")

    lat, lon = table["lat"], table["lon"]
    if lat.null_count < table.num_rows:
        if pc.min(lat).as_py() < LAT_RANGE[0] or pc.max(lat).as_py() > LAT_RANGE[1]:
            problems.append("lat outside Germany.")
        if pc.min(lon).as_py() < LON_RANGE[0] or pc.max(lon).as_py() > LON_RANGE[1]:
            problems.append("lon outside Germany.")

    person = table["operator_is_person"]
    for col in ["name", "operator_name", "lat", "lon"]:
        leaks = pc.sum(pc.and_(person, pc.is_valid(table[col]))).as_py() or 0
        if leaks:
            problems.append(f"PRIVACY: {leaks} natural-person units have {col}.")

    if previous_rows:
        current = Counter(table["technology"].to_pylist())
        for tech, before in previous_rows.items():
            now = current.get(tech, 0)
            if before and abs(now - before) / before > 0.05:
                warnings.append(f"{tech}: row count changed {before:,} → {now:,} (> 5%).")

    if problems:
        raise UnitsCheckError("; ".join(problems))
    if report is not None:
        report.warnings.extend(warnings)
    return warnings


def export_date_of(units_path: Path) -> date:
    """Read the export date that station 2 stored in units.parquet."""
    meta = pq.read_schema(units_path).metadata or {}
    if b"export_date" not in meta:
        raise UnitsCheckError(f"{units_path} has no export_date metadata.")
    return date.fromisoformat(meta[b"export_date"].decode())


def write_report(path: Path, report: Report) -> None:
    path.write_text(json.dumps(report.to_dict(), indent=2, ensure_ascii=False) + "\n")


def read_previous_rows(path: Path) -> dict[str, int] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text()).get("rows")
