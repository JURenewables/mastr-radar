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
    nulled_storage_capacity: int = 0
    implausible_commissioning: int = 0
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


def read_lookup(zf: zipfile.ZipFile, spec: dict) -> dict[str, float | None]:
    """Read a key → value table, e.g. storage plant number → usable capacity (kWh).

    With `split_by_list`, the value is divided by the number of entries in that
    comma-separated field (the plant's linked units).
    """
    out: dict[str, float | None] = {}
    for r in iter_records(zf, spec["files"], spec["record"]):
        value = _float(r.get(spec["value"]))
        if value is not None and spec.get("split_by_list"):
            linked = [x for x in (r.get(spec["split_by_list"]) or "").split(",") if x.strip()]
            value /= max(len(linked), 1)
        out[_get(r, spec["key"])] = value
    return out


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


OPERATOR_REGISTER_SCHEMA = pa.schema(
    [
        ("operator_id", pa.string()),
        ("name", pa.string()),
        ("street", pa.string()),
        ("house_number", pa.string()),
        ("postcode", pa.string()),
        ("city", pa.string()),
        ("register_court", pa.string()),
        ("register_number", pa.string()),
    ]
)


def write_operator_register(zip_path: Path, out_path: Path, cfg: dict | None = None) -> int:
    """Station 2 (v1.6 draft): organisations from Marktakteure with their office
    address and commercial register entry → operators.parquet. Natural persons
    are left out entirely (D4). Returns the number of rows."""
    cfg = cfg or load_columns_config()
    oc = cfg["operators"]
    reg = oc["register"]
    rows = []
    with zipfile.ZipFile(zip_path) as zf:
        catalog = read_catalog(zf)
        for r in iter_records(zf, oc["files"], oc["record"]):
            kind = catalog.get(r.get(oc["person_type"]) or "", "")
            if kind.startswith(oc["person_value_prefix"]) or not r.get(oc["name"]):
                continue
            court = r.get(reg["register_court"])
            rows.append(
                {
                    "operator_id": r.get(oc["id"]),
                    "name": _text(r.get(oc["name"])),
                    "street": _text(r.get(reg["street"])),
                    "house_number": _text(r.get(reg["house_number"])),
                    "postcode": _text(r.get(reg["postcode"])),
                    "city": _text(r.get(reg["city"])),
                    "register_court": catalog.get(court or "", court),
                    "register_number": _text(r.get(reg["register_number"])),
                }
            )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.Table.from_pylist(rows, OPERATOR_REGISTER_SCHEMA), out_path, compression="zstd"
    )
    return len(rows)


UNIT_DETAILS_SCHEMA = pa.schema(
    [
        ("unit_id", pa.string()),
        ("technology", pa.string()),
        ("location_id", pa.string()),
        ("grid_voltage", pa.string()),
        ("grid_capacity_kw", pa.float64()),
        ("award_no", pa.string()),
        ("award_kw", pa.float64()),
        ("yield_ratio_pct", pa.float64()),
        ("permit_date", pa.date32()),
        ("permit_kind", pa.string()),
        ("solar_kind", pa.string()),
        ("solar_orientation", pa.string()),
        ("solar_tracker", pa.bool_()),
        ("solar_area_ha", pa.float64()),
        ("solar_land_before", pa.string()),
        ("solar_features", pa.string()),
        ("storage_same_site", pa.bool_()),
        ("high_voltage", pa.bool_()),
        ("park_name", pa.string()),
    ]
)


def _flag(v) -> bool | None:
    return None if v in (None, "") else v.strip() in ("1", "true", "True")


def write_unit_details(zip_path: Path, out_path: Path, cfg: dict | None = None) -> int:
    """Station 2 (v1.7 draft): details for auction analysis, joined from the
    unit, EEG, permit and grid-connection files → unit_details.parquet."""
    cfg = cfg or load_columns_config()
    dc = cfg["unit_details"]
    sc = dc["solar"]
    rows: dict[str, dict] = {}
    with zipfile.ZipFile(zip_path) as zf:
        catalog = read_catalog(zf)

        def cat(v):
            return None if v in (None, "") else catalog.get(v, v)

        def base(r, tech):
            return {
                "unit_id": r.get("EinheitMastrNummer"),
                "technology": tech,
                "location_id": r.get(dc["common"]["location_id"]),
                "_eeg": r.get("EegMaStRNummer") or r.get("EegMastrNummer"),
                "_permit": r.get(dc["common"]["permit_id"]),
            }

        wsrc = cfg["sources"]["wind"]
        for r in iter_records(zf, wsrc["files"], wsrc["record"]):
            tech = wsrc["technology_values"].get(cat(r.get(wsrc["technology_field"])) or "")
            if tech != "wind_onshore":
                continue
            row = base(r, tech)
            row["park_name"] = _text(r.get("NameWindpark"))
            rows[row["unit_id"]] = row
        for r in iter_records(
            zf, cfg["sources"]["solar"]["files"], cfg["sources"]["solar"]["record"]
        ):
            kind = cat(r.get(sc["kind"]))
            kw = _float(r.get("Bruttoleistung")) or 0
            small_kind = kind in ("Gebäudesolaranlage",) or (kind or "").startswith(
                "Steckerfertige"
            )
            if small_kind and kw < dc["solar_min_kw"]:
                continue
            row = base(r, "solar")
            orient = cat(r.get(sc["orientation"]))
            feats = [cat(x.strip()) for x in (r.get(sc["features"]) or "").split(",") if x.strip()]
            row.update(
                solar_kind=kind,
                solar_orientation=orient,
                solar_tracker=None if orient is None else orient == sc["tracker_value"],
                solar_area_ha=_float(r.get(sc["area_ha"])),
                solar_land_before=cat(r.get(sc["land_before"])),
                solar_features="; ".join(f for f in feats if f) or None,
                storage_same_site=_flag(r.get(sc["storage_same_site"])),
                high_voltage=_flag(r.get(sc["high_voltage"])),
                park_name=_text(r.get(sc["park_name"])),
            )
            rows[row["unit_id"]] = row
        stc = cfg["sources"]["storage"]
        for r in iter_records(zf, stc["files"], stc["record"]):
            if (_float(r.get("Bruttoleistung")) or 0) < dc["storage_min_kw"]:
                continue
            row = base(r, "storage")
            rows[row["unit_id"]] = row

        ec = dc["eeg"]
        want_eeg = {r["_eeg"]: uid for uid, r in rows.items() if r["_eeg"]}
        for files, record in zip(ec["files"], ec["records"], strict=True):
            for r in iter_records(zf, files, record):
                uid = want_eeg.get(r.get(ec["id"]))
                if uid:
                    rows[uid].update(
                        award_no=_text(r.get(ec["award_no"])),
                        award_kw=_float(r.get(ec["award_kw"])),
                        yield_ratio_pct=_float(r.get(ec["yield_ratio"])),
                    )
        pc_ = dc["permits"]
        want_permit = {}
        for uid, r in rows.items():
            if r["_permit"]:
                want_permit.setdefault(r["_permit"], []).append(uid)
        for r in iter_records(zf, pc_["files"], pc_["record"]):
            for uid in want_permit.get(r.get(pc_["id"]), []):
                rows[uid].update(
                    permit_date=_date(r.get(pc_["date"])), permit_kind=cat(r.get(pc_["kind"]))
                )
        gc = dc["grid"]
        want_loc = {}
        for uid, r in rows.items():
            if r["location_id"]:
                want_loc.setdefault(r["location_id"], []).append(uid)
        for r in iter_records(zf, gc["files"], gc["record"]):
            for uid in want_loc.get(r.get(gc["location_id"]), []):
                cap = _float(r.get(gc["capacity_kw"]))
                prev = rows[uid].get("grid_capacity_kw") or 0
                if "grid_voltage" not in rows[uid] or (cap or 0) > prev:
                    rows[uid].update(grid_voltage=cat(r.get(gc["voltage"])), grid_capacity_kw=cap)
    names = UNIT_DETAILS_SCHEMA.names
    table = pa.Table.from_pylist(
        [{k: r.get(k) for k in names} for r in rows.values()], UNIT_DETAILS_SCHEMA
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, out_path, compression="zstd")
    return table.num_rows


GRID_UNITS_SCHEMA = pa.schema(
    [
        ("unit_id", pa.string()),
        ("grid_operator_id", pa.string()),
        ("control_area", pa.string()),
        ("voltage", pa.string()),
    ]
)
GRID_OPERATORS_SCHEMA = pa.schema(
    [("operator_id", pa.string()), ("tso", pa.bool_()), ("dso", pa.bool_())]
)
CONSUMERS_SCHEMA = pa.schema(
    [
        ("unit_id", pa.string()),
        ("status", pa.string()),
        ("state", pa.string()),
        ("district", pa.string()),
        ("district_key", pa.string()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("units_over_50mw", pa.int32()),
        ("commissioning_date", pa.date32()),
        ("planned_date", pa.date32()),
        ("operator_id", pa.string()),
        ("control_area", pa.string()),
    ]
)


def write_grid_register(
    zip_path: Path, details_path: Path, out_dir: Path, cfg: dict | None = None
) -> dict[str, int]:
    """Station 2 (v1.7 draft, WP71): grid operator, control area and voltage per
    unit in unit_details.parquet; grid operator roles; large electricity
    consumers. Writes grid_units, grid_operators and consumers parquet files."""
    cfg = cfg or load_columns_config()
    gc = cfg["grid_register"]
    details = pq.read_table(details_path, columns=["unit_id", "location_id"]).to_pylist()
    want: dict[str, list[str]] = {}
    for d in details:
        if d["location_id"]:
            want.setdefault(d["location_id"], []).append(d["unit_id"])
    units: dict[str, dict] = {}
    caps: dict[str, float] = {}
    roles: dict[str, dict] = {}
    consumers = []
    with zipfile.ZipFile(zip_path) as zf:
        catalog = read_catalog(zf)

        def cat(v):
            return None if v in (None, "") else catalog.get(v, v)

        c = gc["connections"]
        for r in iter_records(zf, c["files"], c["record"]):
            ids = want.get(r.get(c["location_id"]))
            if not ids:
                continue
            cap = _float(r.get(c["capacity_kw"])) or 0
            for uid in ids:
                if uid in units and cap <= caps[uid]:
                    continue
                caps[uid] = cap
                units[uid] = {
                    "unit_id": uid,
                    "grid_operator_id": r.get(c["grid_operator_id"]),
                    "control_area": cat(r.get(c["control_area"])),
                    "voltage": gc["voltage_values"].get(cat(r.get(c["voltage"])) or "", None),
                }
        rc = gc["roles"]
        for r in iter_records(zf, rc["files"], rc["record"]):
            aid = r.get(rc["actor_id"]) or ""
            if not aid.startswith(rc["electricity_prefix"]):
                continue
            role = r.get(rc["role"])
            row = roles.setdefault(aid, {"operator_id": aid, "tso": False, "dso": False})
            row["tso"] |= role == rc["tso_value"]
            row["dso"] |= role == rc["dso_value"]
        cc = gc["consumers"]
        for r in iter_records(zf, cc["files"], cc["record"]):
            key = r.get(cc["municipality_key"]) or ""
            n = r.get(cc["over_50mw"])
            consumers.append(
                {
                    "unit_id": r.get(cc["id"]),
                    "status": gc["status_values"].get(cat(r.get(cc["status"])) or "", None),
                    "state": cat(r.get(cc["state"])),
                    "district": _text(r.get(cc["district"])),
                    "district_key": key[:5] or None,
                    "lat": _float(r.get(cc["lat"])),
                    "lon": _float(r.get(cc["lon"])),
                    "units_over_50mw": int(n) if n and n.isdigit() else None,
                    "commissioning_date": _date(r.get(cc["commissioning_date"])),
                    "planned_date": _date(r.get(cc["planned_date"])),
                    "operator_id": r.get(cc["operator_id"]),
                    "control_area": cat((r.get(cc["control_area"]) or "").split(",")[0].strip()),
                }
            )
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    for name, rows, schema in (
        ("grid_units.parquet", list(units.values()), GRID_UNITS_SCHEMA),
        ("grid_operators.parquet", list(roles.values()), GRID_OPERATORS_SCHEMA),
        ("consumers.parquet", consumers, CONSUMERS_SCHEMA),
    ):
        pq.write_table(pa.Table.from_pylist(rows, schema), out_dir / name, compression="zstd")
        counts[name] = len(rows)
    return counts


def check_grid_register(out_dir: Path, cfg: dict | None = None) -> None:
    cfg = cfg or load_columns_config()
    gc = cfg["grid_register"]
    problems = []
    for name, schema, minimum in (
        ("grid_units.parquet", GRID_UNITS_SCHEMA, gc["min_connections"]),
        ("grid_operators.parquet", GRID_OPERATORS_SCHEMA, 100),
        ("consumers.parquet", CONSUMERS_SCHEMA, gc["min_consumers"]),
    ):
        t = pq.read_table(out_dir / name)
        if t.schema.remove_metadata() != schema:
            problems.append(f"{name}: columns differ from the contract.")
        if t.num_rows < minimum:
            problems.append(f"{name}: {t.num_rows} rows, expected at least {minimum}.")
    ops = pq.read_table(out_dir / "grid_operators.parquet").to_pandas()
    if not 3 <= int(ops["tso"].sum()) <= 6:
        problems.append("grid_operators.parquet: expected the four TSOs.")
    if problems:
        raise UnitsCheckError("; ".join(problems))


def check_unit_details(path: Path, min_rows: int) -> None:
    table = pq.read_table(path)
    problems = []
    if table.schema.remove_metadata() != UNIT_DETAILS_SCHEMA:
        problems.append("unit_details.parquet: columns differ from the contract.")
    if table.num_rows < min_rows:
        problems.append(
            f"unit_details.parquet: {table.num_rows} rows, expected at least {min_rows}."
        )
    ids = table.column("unit_id")
    if ids.null_count or len(set(ids.to_pylist())) != table.num_rows:
        problems.append("unit_details.parquet: unit ids missing or not unique.")
    if problems:
        raise UnitsCheckError("; ".join(problems))


def check_operator_register(path: Path, min_rows: int) -> None:
    table = pq.read_table(path)
    problems = []
    if table.schema.remove_metadata() != OPERATOR_REGISTER_SCHEMA:
        problems.append("operators.parquet: columns differ from the contract.")
    if table.num_rows < min_rows:
        problems.append(f"operators.parquet: {table.num_rows} rows, expected at least {min_rows}.")
    ids = table.column("operator_id")
    if ids.null_count or len(set(ids.to_pylist())) != table.num_rows:
        problems.append("operators.parquet: operator ids missing or not unique.")
    if problems:
        raise UnitsCheckError("; ".join(problems))


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

    def __init__(
        self, cfg, src_cfg, catalog, operators, export_date: date, report: Report, lookups=None
    ):
        self.cfg, self.src, self.catalog = cfg, src_cfg, catalog
        self.operators, self.export_date, self.report = operators, export_date, report
        self.catalog_fields = set(cfg["catalog_fields"])
        self.lookups = lookups or {}

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

        # Technology details. Value maps turn German values into contract enums;
        # an unmapped value stays as it is, so the check fails loudly.
        value_maps = self.src.get("detail_values", {})
        for col, source in self.src.get("details", {}).items():
            value = self.raw(rec, source)
            if col in value_maps and value is not None:
                vmap = value_maps[col]
                value = vmap.get(value, vmap.get("_default", value))
            is_float = UNITS_SCHEMA.field(col).type == pa.float64()
            row[col] = _float(value) if is_float else _text(value)
        for col, spec in self.src.get("lookup_details", {}).items():
            key = _get(rec, spec["via"])
            row[col] = self.lookups.get(spec["lookup"], {}).get(key)

        self._apply_quality_rules(row)
        return row

    def _apply_quality_rules(self, row: dict) -> None:
        """Data quality rules from the mapping (WP12): empty impossible values, count them."""
        limits = self.src.get("storage_capacity_max_hours")
        kwh, kw = row.get("storage_capacity_kwh"), row.get("capacity_kw")
        if limits and kwh is not None and kw:
            limit = limits.get(row.get("storage_technology"), limits.get("_all"))
            if limit is not None and kwh / kw > limit:
                row["storage_capacity_kwh"] = None
                self.report.nulled_storage_capacity += 1
        min_dates = self.src.get("min_commissioning_date")
        cod = row.get("commissioning_date")
        if min_dates and cod is not None:
            key = row.get("storage_technology")
            earliest = min_dates.get(key, min_dates.get("_all")) if key else min_dates.get("_all")
            if earliest is not None and cod < earliest:
                row["commissioning_date"] = None
                self.report.implausible_commissioning += 1


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
        needed = {
            spec["lookup"]
            for src in sources
            for spec in cfg["sources"][src].get("lookup_details", {}).values()
        }
        lookups = {name: read_lookup(zf, cfg["lookups"][name]) for name in sorted(needed)}
        # The export date travels inside the file, for station 3 (manifest as_of).
        file_schema = UNITS_SCHEMA.with_metadata({"export_date": export_date.isoformat()})
        writer = pq.ParquetWriter(tmp, file_schema, compression="zstd")
        try:
            for source in sources:
                src_cfg = cfg["sources"][source]
                transform = Transformer(
                    cfg, src_cfg, catalog, operators, export_date, report, lookups
                )
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

    # D12: impossible commissioning dates must be gone.
    for tech, storage_type, earliest in [
        ("solar", None, date(1983, 1, 1)),
        ("storage", "battery", date(2000, 1, 1)),
    ]:
        mask = pc.equal(table["technology"], tech)
        if storage_type:
            mask = pc.and_(mask, pc.equal(table["storage_technology"], storage_type))
        early = pc.less(table["commissioning_date"], pa.scalar(earliest, pa.date32()))
        if pc.sum(pc.fill_null(pc.and_(mask, early), False)).as_py():
            problems.append(f"{tech}: commissioning dates before {earliest} remain (D12).")

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
