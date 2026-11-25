"""Profitability model and co-location (contract v1.12) on tiny fixtures."""

import datetime
import json

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from mastr_radar import colocation, profitability
from mastr_radar.extract import UNITS_SCHEMA


def test_irr_and_npv():
    cfs = [-100, 10, 10, 10, 10, 10, 10, 10, 10, 10, 110]
    assert profitability.irr(cfs) == pytest.approx(0.10, abs=1e-3)
    assert profitability.npv(0.10, cfs) == pytest.approx(0, abs=1e-6)
    assert profitability.irr([-100, -10]) is None


def test_annuity():
    assert profitability.annuity(1000, 0.05, 20) == pytest.approx(80.24, abs=0.01)


def _wind_award(**kw):
    a = {
        "round": "R1", "bid_date": "2024-05-01", "group": "G", "state": "Niedersachsen",
        "lat": 52.5, "lon": 9.1, "model": "X", "kw": 6000.0, "turbines": 1,
        "hub_height_m": 160, "rotor_diameter_m": 160, "full_load_hours": 3000,
        "received_ct_est": 7.0, "quality_pct": 80.0,
    }  # fmt: skip
    a.update(kw)
    return a


@pytest.fixture
def cfg():
    import yaml

    return yaml.safe_load(profitability.CONFIG_PATH.read_text())


def test_wind_project_capex_from_formula(cfg):
    trend = {2024: 1235.0}
    p = profitability.wind_project(_wind_award(), cfg["wind"], trend, ct_market=9.0)
    sfl = 6e6 / (3.141592653589793 * 80**2)
    hik = 1743.95 - 81.21 * 6 - 1.66 * sfl + 2.91 * 160
    assert p["capex"] == round(hik + 506)
    assert p["revenue"] == 210
    assert p["project_irr"] is not None and p["project_irr_full"] > p["project_irr"]
    # a higher price can only raise the return and the affordable investment
    q = profitability.wind_project(_wind_award(received_ct_est=8.0), cfg["wind"], trend)
    assert q["project_irr"] > p["project_irr"] and q["max_capex"] > p["max_capex"]


def test_wind_project_skips_bad_inputs(cfg):
    assert (
        profitability.wind_project(_wind_award(full_load_hours=None), cfg["wind"], {2024: 1})
        is None
    )
    assert (
        profitability.wind_project(_wind_award(received_ct_est=30), cfg["wind"], {2024: 1}) is None
    )


def test_solar_project(cfg):
    aw = {
        "programme": "solar",
        "round": "S1",
        "bid_date": "2025-03-01",
        "kw": 10000,
        "specific_yield_kwh_kwp": 1100,
    }
    p = profitability.solar_project(aw, 5.0, cfg["solar"], ct_market=6.0)
    assert p["capex"] == 800 and p["revenue"] == 55
    assert p["project_irr_low_capex"] > p["project_irr"]
    assert profitability.solar_project({**aw, "programme": "innovation"}, 5.0, cfg["solar"]) is None


def _unit(uid, tech, lat, lon, kw=3000.0, status="operating", person=False, solar_type=None):
    row = dict.fromkeys(UNITS_SCHEMA.names)
    row.update(
        unit_id=uid, technology=tech, status=status, capacity_kw=kw, lat=lat, lon=lon,
        state="Niedersachsen", district="X", operator_is_person=person, operator_name="Co GmbH",
        solar_type=solar_type, commissioning_date=datetime.date(2024, 1, 1),
    )  # fmt: skip
    return row


def test_colocation(tmp_path):
    ex = tmp_path / "extract"
    ex.mkdir()
    rows = [
        _unit("W1", "wind_onshore", 52.0, 9.0),
        _unit("W2", "wind_onshore", 52.0, 9.01),
        _unit("B1", "storage", 52.002, 9.0, kw=5000, status="planned"),  # ~220 m: nearby
        _unit("B2", "storage", 52.05, 9.0, kw=5000),  # 5.5 km: not
        _unit(
            "S1", "solar", 52.0, 9.011, kw=200, solar_type="ground_mounted"
        ),  # same location, small ok
        _unit("S2", "solar", 52.001, 9.0, kw=2000, solar_type="rooftop"),  # rooftop: not
    ]
    pq.write_table(pa.Table.from_pylist(rows, UNITS_SCHEMA), ex / "units.parquet")
    det = [
        {"unit_id": "W2", "location_id": "L1", "award_no": "A1"},
        {"unit_id": "S1", "location_id": "L1", "award_no": None},
    ]
    pq.write_table(pa.Table.from_pylist(det), ex / "unit_details.parquet")
    out = tmp_path / "data"
    (out / "auctions").mkdir(parents=True)
    (out / "auctions" / "awards.json").write_text(
        json.dumps({"awards": [{"award_no": "A1", "bid_date": "2024-05-01"}]})
    )
    colocation.build(ex, out, datetime.date(2026, 11, 25))
    d = json.loads((out / colocation.FILE).read_text())
    kinds = {(s["tier"], s["kind"]) for s in d["sites"]}
    assert kinds == {("same_location", "solar"), ("nearby", "storage")}
    same = next(s for s in d["sites"] if s["tier"] == "same_location")
    assert same["award_rounds"] == ["2024-05-01"] and same["wind_units"] == 1
    near = next(s for s in d["sites"] if s["tier"] == "nearby")
    assert (
        near["distance_km"] < 0.5
        and near["wind_units"] == 2
        and near["partner_status"] == "planned"
    )
    colocation.check(out)
