"""Station 2 (contract v1.13, WP101): other assets for multi-asset hubs.

Combustion plants (≥ 1 MW), gas producers (incl. electrolysers), gas
consumers, gas storage and large electricity consumers from the bulk export
→ data/extract/assets_other.parquet (internal). German source names live in
config/columns.yaml (other_assets).
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from mastr_radar.extract import (
    UnitsCheckError,
    _date,
    _float,
    _text,
    iter_records,
    load_columns_config,
    read_catalog,
    read_operators,
)

SCHEMA = pa.schema(
    [
        ("unit_id", pa.string()),
        ("kind", pa.string()),
        ("subtype", pa.string()),
        ("name", pa.string()),
        ("status", pa.string()),
        ("capacity_kw", pa.float64()),
        ("state", pa.string()),
        ("district", pa.string()),
        ("municipality_key", pa.string()),
        ("lat", pa.float64()),
        ("lon", pa.float64()),
        ("location_id", pa.string()),
        ("operator_id", pa.string()),
        ("operator_name", pa.string()),
        ("operator_is_person", pa.bool_()),
        ("commissioning_date", pa.date32()),
        ("planned_commissioning_date", pa.date32()),
    ]
)
KINDS = {
    "gas_plant", "hydrogen_plant", "other_combustion", "electrolyser", "gas_production",
    "gas_consumer", "gas_storage", "large_consumer",
}  # fmt: skip


def write_other_assets(zip_path: Path, out_path: Path, cfg: dict | None = None) -> dict[str, int]:
    cfg = cfg or load_columns_config()
    oc = cfg["other_assets"]
    c = oc["common"]
    statuses = cfg["status"]
    active = cfg["active_system_status"]
    rows: list[dict] = []
    with zipfile.ZipFile(zip_path) as zf:
        catalog = read_catalog(zf)
        cat = lambda v: catalog.get(v or "", v)  # noqa: E731

        def base(
            r: dict, kind: str, subtype: str | None, name: str | None, kw: float | None
        ) -> dict:
            return {
                "unit_id": r.get(c["id"]),
                "kind": kind,
                "subtype": subtype,
                "name": _text(name),
                "status": statuses.get(cat(r.get(c["status"]))),
                "capacity_kw": kw,
                "state": cat(r.get(c["state"])),
                "district": _text(r.get(c["district"])),
                "municipality_key": _text(r.get(c["municipality_key"])),
                "lat": _float(r.get(c["lat"])),
                "lon": _float(r.get(c["lon"])),
                "location_id": _text(r.get(c["location_id"])),
                "operator_id": _text(r.get(c["operator_id"])),
                "commissioning_date": _date(r.get(c["commissioning_date"])),
                "planned_commissioning_date": _date(r.get(c["planned_commissioning_date"])),
            }

        def ok(r: dict) -> bool:
            return cat(r.get(c["system_status"])) == active

        s = oc["sources"]["combustion"]
        for r in iter_records(zf, s["files"], s["record"]):
            if not ok(r):
                continue
            kw = _float(r.get(s["capacity_kw"]))
            carrier = oc["carrier_kind"].get(cat(r.get(s["carrier"])), "other")
            if carrier != "hydrogen" and (kw or 0) < oc["combustion_min_kw"]:
                continue
            kind = {"gas": "gas_plant", "hydrogen": "hydrogen_plant"}.get(
                carrier, "other_combustion"
            )
            sub = f"{carrier}; {cat(r.get(s['technology'])) or ''}".strip("; ")
            if r.get(s["chp_id"]):
                sub += "; CHP"
            rows.append(base(r, kind, sub, r.get(s["plant"]) or r.get(s["name"]), kw))

        s = oc["sources"]["gas_producer"]
        for r in iter_records(zf, s["files"], s["record"]):
            if not ok(r):
                continue
            k = oc["gas_producer_kind"].get(cat(r.get(s["technology"])), "gas_production")
            kind = "electrolyser" if k.startswith("electrolyser") else "gas_production"
            rows.append(base(r, kind, k, r.get(s["name"]), _float(r.get(s["capacity_kw"]))))

        s = oc["sources"]["gas_consumer"]
        for r in iter_records(zf, s["files"], s["record"]):
            if not ok(r):
                continue
            sub = "for power generation" if r.get(s["for_power"]) == "1" else None
            rows.append(
                base(r, "gas_consumer", sub, r.get(s["name"]), _float(r.get(s["capacity_kw"])))
            )

        s = oc["sources"]["gas_storage"]
        for r in iter_records(zf, s["files"], s["record"]):
            if not ok(r):
                continue
            rows.append(
                base(
                    r,
                    "gas_storage",
                    cat(r.get(s["technology"])),
                    r.get(s["name"]),
                    _float(r.get(s["capacity_kw"])),
                )
            )

        s = oc["sources"]["large_consumer"]
        for r in iter_records(zf, s["files"], s["record"]):
            if not ok(r):
                continue
            rows.append(base(r, "large_consumer", None, r.get(s["name"]), None))

        # Gas storage sites are also listed as gas producers (their output side)
        # under the same id: keep the storage record.
        storage_ids = {r["unit_id"] for r in rows if r["kind"] == "gas_storage"}
        rows = [r for r in rows if not (r["kind"] != "gas_storage" and r["unit_id"] in storage_ids)]
        ops = read_operators(zf, cfg, catalog, {r["operator_id"] for r in rows if r["operator_id"]})
    for r in rows:
        name, person = ops.get(r["operator_id"], (None, None))
        r["operator_name"] = name
        r["operator_is_person"] = person
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, SCHEMA), out_path)
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    return counts


def check_other_assets(path: Path) -> None:
    t = pq.read_table(path).to_pylist()
    problems = []
    kinds = {r["kind"] for r in t}
    if unknown := kinds - KINDS:
        problems.append(f"unknown kinds {sorted(unknown)}.")
    for need, n in (("gas_plant", 500), ("large_consumer", 300), ("gas_storage", 20)):
        got = sum(r["kind"] == need for r in t)
        if got < n:
            problems.append(f"only {got} {need} (expected ≥ {n}).")
    if len({r["unit_id"] for r in t}) != len(t):
        problems.append("duplicate unit ids.")
    if problems:
        raise UnitsCheckError("Other assets check failed: " + " ".join(problems))
