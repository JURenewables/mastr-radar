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
    assert built[2]["contract_version"] == "1.7"


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
    brandenburg = next(x for x in s["states"] if x["key"] == "12")
    assert brandenburg["population"] > 2_000_000  # BKG VG250-EW


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


# --- Wind industry (contract v1.5 draft) ---

BRANDS = monitor.yaml.safe_load(monitor.BRANDS_CONFIG.read_text())


@pytest.mark.parametrize(
    ("manufacturer", "brand"),
    [
        ("ENERCON GmbH", "Enercon"),
        ("Vestas Deutschland GmbH", "Vestas"),
        ("Nordex Energy SE & Co. KG", "Nordex"),
        ("REpower Systems AG", "Senvion (REpower)"),
        ("Siemens Gamesa Renewable Energy GmbH & Co. KG", "Siemens Gamesa"),
        ("Unbekannter Hersteller", "Other"),
        (None, "Other"),
        (float("nan"), "Other"),
    ],
)
def test_brand_of(manufacturer, brand):
    assert monitor.brand_of(manufacturer, BRANDS) == brand


@pytest.mark.parametrize(
    ("brand", "model", "family"),
    [
        ("Enercon", "E-160 EP5 E3 R1", "E-160"),
        ("Enercon", "E138 EP3", "E-138"),
        ("Vestas", "V162-6.2 MW", "V162"),
        ("Nordex", "N163/6.X", "N163"),
        ("Vestas", None, None),
        ("Other", "XY-100", None),
    ],
)
def test_model_family(brand, model, family):
    assert monitor.model_family(brand, model, BRANDS) == family


def test_wind_industry(tmp_path):
    rows = [
        wind("A", 2000, date(2001, 5, 1), manufacturer="ENERCON GmbH", turbine_model="E-70"),
        wind(
            "B",
            6000,
            date(2025, 3, 1),
            manufacturer="Vestas",
            turbine_model="V162-6.2",
            hub_height_m=160.0,
            rotor_diameter_m=162.0,
        ),
        wind(
            "C",
            6000,
            date(2026, 3, 1),
            manufacturer="Vestas",
            turbine_model="V162-6.2",
            hub_height_m=150.0,
            rotor_diameter_m=162.0,
        ),
        wind("D", 3000, date(2026, 4, 1), manufacturer="Mystery Wind"),
        wind("E", 3000, None, status="planned", manufacturer="Nordex"),  # not in series
    ]
    units = write_units(tmp_path / "units.parquet", rows)
    out = tmp_path / "data"
    ag.build(units, out, monitor_settings=SETTINGS)
    wi = json.loads((out / "monitor" / "stats.json").read_text())["wind_industry"]
    assert wi["brands"] == ["Vestas", "Enercon", "Other"]
    i25, i26 = wi["years"].index(2025), wi["years"].index(2026)
    assert wi["added_mw"]["Vestas"][i25] == 6
    assert wi["installed_mw"]["Vestas"][i26] == 12
    assert wi["installed_mw"]["Other"][i26] == 3
    v162 = next(m for m in wi["recent_models"] if m["model"] == "V162")
    assert (v162["units"], v162["mw"], v162["avg_hub_height_m"]) == (2, 12, 155)
    assert wi["unattributed_share"] == pytest.approx(3 / 17, abs=1e-3)
