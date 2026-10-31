"""Station 3 tests on a small hand-made units.parquet."""

import json
from datetime import date, timedelta

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from mastr_radar import aggregate as ag
from mastr_radar.extract import UNITS_SCHEMA

AS_OF = date(2026, 10, 30)


def unit(uid, tech="wind_onshore", status="operating", kw=3000.0, cod=date(2020, 1, 1), lag=10):
    row = dict.fromkeys(UNITS_SCHEMA.names)
    row.update(
        unit_id=uid,
        technology=tech,
        status=status,
        capacity_kw=kw,
        size_class="1–10 MW",
        commissioning_date=cod,
        registration_date=(cod + timedelta(days=lag)) if cod else date(2025, 1, 1),
        last_updated=date(2026, 1, 1),
        operator_is_person=False,
        manufacturer="ENERCON GmbH" if tech == "wind_onshore" else None,
    )
    return row


def write_units(path, rows, as_of=AS_OF):
    schema = UNITS_SCHEMA.with_metadata({"export_date": as_of.isoformat()})
    pq.write_table(pa.Table.from_pylist(rows, schema), path)
    return path


@pytest.fixture
def built(tmp_path):
    rows = [
        unit("A", kw=3000),
        unit("B", kw=2000, cod=date(2026, 3, 1)),  # added this year
        unit("C", status="planned", kw=5000, cod=None),
        unit("D", status="permanently_shut_down", kw=600, cod=date(1999, 5, 1)),
        unit("E", tech="wind_offshore", kw=8000, cod=date(2026, 8, 1)),
    ]
    # 60 onshore units commissioned a year ago, 90% registered within 20 days.
    named = unit("N", kw=500)  # company-owned but below 1 MW
    named["operator_name"] = "Small Solar GmbH"
    big_named = unit("M", kw=1500)
    big_named["operator_name"] = "Big Wind GmbH"
    rows += [named, big_named]
    rows += [
        unit(f"L{i}", kw=1, cod=date(2025, 10, 1), lag=(20 if i < 54 else 100)) for i in range(60)
    ]
    units = write_units(tmp_path / "units.parquet", rows)
    out = tmp_path / "data"
    manifest = ag.build(units, out)
    return units, out, manifest


def test_kpis(built):
    _, out, _ = built
    kpis = {k["technology"]: k for k in json.loads((out / "kpis.json").read_text())}
    on = kpis["wind_onshore"]
    assert on["installed_capacity_kw"] == 3000 + 2000 + 500 + 1500 + 60
    assert on["installed_units"] == 64
    assert on["planned_capacity_kw"] == 5000
    assert on["added_capacity_kw_ytd"] == 2000
    assert kpis["wind_offshore"]["added_capacity_kw_ytd"] == 8000


def test_manifest(built):
    _, out, manifest = built
    assert manifest["contract_version"] == "1.5"
    assert manifest["as_of"] == "2026-10-30"
    files = {f["name"]: f for f in manifest["files"]}
    assert set(files) == {
        "kpis.json",
        "units.parquet",
        "summary.parquet",
        "boundaries/states.geojson",
        "boundaries/districts.geojson",
    }
    assert files["kpis.json"]["rows"] == 2
    assert files["boundaries/states.geojson"]["rows"] == 16


def test_incomplete_after_per_technology(built):
    _, _, manifest = built
    inc = manifest["incomplete_after"]
    # 90% of onshore units registered within 20 days.
    assert inc["wind_onshore"] == (AS_OF - timedelta(days=20)).isoformat()
    # Offshore has too few units in the window → 60-day fallback.
    assert inc["wind_offshore"] == (AS_OF - timedelta(days=60)).isoformat()


def test_check_passes(built):
    units, out, _ = built
    ag.check_explorer_files(out, units)


def test_check_catches_tampered_kpis(built):
    units, out, _ = built
    kpis = json.loads((out / "kpis.json").read_text())
    kpis[0]["installed_capacity_kw"] += 1_000_000
    (out / "kpis.json").write_text(json.dumps(kpis))
    with pytest.raises(ag.ExplorerCheckError) as err:
        ag.check_explorer_files(out, units)
    assert "does not match" in str(err.value)
    assert "wrong size" in str(err.value)  # manifest no longer matches the file


def test_check_catches_wrong_contract_version(built):
    units, out, _ = built
    m = json.loads((out / "manifest.json").read_text())
    m["contract_version"] = "0.9"
    del m["pipeline_version"]
    (out / "manifest.json").write_text(json.dumps(m))
    with pytest.raises(ag.ExplorerCheckError) as err:
        ag.check_explorer_files(out, units)
    assert "contract_version" in str(err.value)
    assert "missing ['pipeline_version']" in str(err.value)


def test_web_units(built):
    _, out, _ = built
    web = {r["unit_id"]: r for r in pq.read_table(out / "units.parquet").to_pylist()}
    assert "L0" not in web  # 1 kW: only in the summary
    assert set(web) == {"A", "B", "C", "D", "E", "N", "M"}
    assert web["N"]["operator_name"] is None  # below 1 MW: no operator name
    assert web["M"]["operator_name"] == "Big Wind GmbH"
    assert "eeg_id" not in web["A"] and "postcode" not in web["A"]


def test_summary_covers_all_units(built):
    _, out, _ = built
    s = pq.read_table(out / "summary.parquet").to_pylist()
    onshore = [r for r in s if r["technology"] == "wind_onshore"]
    assert sum(r["unit_count"] for r in onshore) == 66
    assert sum(r["capacity_kw"] for r in onshore) == 3000 + 2000 + 5000 + 600 + 500 + 1500 + 60
    planned = [r for r in onshore if r["status"] == "planned"]
    assert planned[0]["commissioning_month"] is None
    months = {r["commissioning_month"] for r in onshore}
    assert "2026-03" in months and "2025-10" in months


def test_check_catches_tampered_summary(built):
    units, out, _ = built
    s = pq.read_table(out / "summary.parquet")
    pq.write_table(s.slice(1), out / "summary.parquet")
    with pytest.raises(ag.ExplorerCheckError) as err:
        ag.check_explorer_files(out, units)
    assert "totals for" in str(err.value)
