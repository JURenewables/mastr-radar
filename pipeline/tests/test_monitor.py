"""Station 3 monitor files (contract v1.3 draft) on a small hand-made units table."""

import json
from datetime import date

import pytest

from mastr_radar import aggregate as ag
from mastr_radar import monitor
from mastr_radar.config import load_settings
from tests.test_aggregate import unit, write_units

AS_OF = date(2026, 10, 30)
SETTINGS = load_settings().monitor


def wind(
    uid, kw, cod, status="operating", shutdown=None, person=False, lat=52.5, lon=13.4, **extra
):
    row = unit(uid, kw=kw, cod=cod, status=status)
    row.update(
        state_key="12",
        district_key="12063",
        lat=None if person else lat,
        lon=None if person else lon,
        operator_is_person=person,
        shutdown_date=shutdown,
        **extra,
    )
    return row


@pytest.fixture
def built(tmp_path):
    rows = [
        wind("A", 2000, date(2001, 5, 1), hub_height_m=80.0, rotor_diameter_m=70.0),
        wind("B", 5000, date(2025, 3, 1), hub_height_m=160.0, rotor_diameter_m=150.0),
        wind(
            "C", 1500, date(1999, 6, 1), status="permanently_shut_down", shutdown=date(2020, 1, 1)
        ),
        # Permanently shut down without a date: retirement unknown → left out of series.
        wind("D", 9999, date(2000, 1, 1), status="permanently_shut_down"),
        wind("E", 3000, date(2026, 2, 1), person=True),  # private owner: no point
        wind("F", 4000, None, status="planned", lat=53.0, lon=9.0),
        wind("G", 500, date(2026, 4, 1)),  # below 1 MW: no point
    ]
    units = write_units(tmp_path / "units.parquet", rows)
    out = tmp_path / "data"
    manifest = ag.build(units, out, monitor_settings=SETTINGS)
    read = lambda n: json.loads((out / "monitor" / n).read_text())  # noqa: E731
    return units, out, manifest, read("buildout.json"), read("points.json"), read("stats.json")


def test_manifest_lists_monitor_files(built):
    names = {f["name"] for f in built[2]["files"]}
    assert {"monitor/buildout.json", "monitor/points.json", "monitor/stats.json"} <= names
    assert built[2]["contract_version"] == "1.3"


def test_buildout_series(built):
    b = built[3]
    years = b["years"]
    assert years[0] == 1990 and years[-1] == 2026
    nat = b["national"]["wind_onshore"]
    i = years.index
    assert nat["added"][i(2001)] == 2 and nat["added"][i(2025)] == 5
    assert nat["retired"][i(2020)] == 2  # C: 1.5 MW rounds to 2
    assert nat["installed"][i(2019)] == round(1.5 + 2)  # C and A
    assert nat["installed"][-1] == 10  # A, B, E, G = 10.5 MW (D left out)
    assert b["district"]["wind_onshore"]["12063"][-1] == 10


def test_points_respect_privacy_and_size(built):
    p = built[4]
    ops = [p["operating"][i : i + 5] for i in range(0, len(p["operating"]), 5)]
    assert len(ops) == 2  # A and B; not E (private), not G (< 1 MW), not shut-down units
    assert {o[2] for o in ops} == {2001 - 1990, 2025 - 1990}
    assert p["planned_onshore"] == [900, 5300, 4]


def test_stats(built):
    s = built[5]
    assert s["repowering"]["units"] == 1 and s["repowering"]["mw"] == 2  # A (2001)
    t = s["onshore_turbines"]
    assert t["avg_hub_height_m"][t["years"].index(2025)] == 160.0
    assert s["ytd_cumulative_mw"]["wind_onshore"]["2026"][-1] == 4  # E + G, Feb-Apr
    assert len(s["ytd_cumulative_mw"]["wind_onshore"]["2026"]) == 10  # Jan-Oct
    assert s["planned_mw"]["wind_onshore"] == 4
    assert s["targets_2030_mw"]["solar"] == 215000


def test_check_catches_broken_monitor_file(built):
    units, out, *_ = built
    (out / "monitor" / "points.json").write_text(
        json.dumps({"operating": [1, 2, 3], "planned_onshore": []})
    )
    with pytest.raises(ag.ExplorerCheckError, match="multiple of 5"):
        ag.check_explorer_files(out, units)


def test_check_passes(built):
    units, out, *_ = built
    ag.check_explorer_files(out, units)
    monitor.check(out, json.loads((out / "kpis.json").read_text()), AS_OF)
