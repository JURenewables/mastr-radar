"""Auctions (contract v1.5 draft) on a tiny hand-made round page and award list."""

import json
from datetime import date

import numpy as np
import openpyxl
import pytest
import yaml

from mastr_radar import auctions
from tests.test_aggregate import unit, write_units

CFG = yaml.safe_load(auctions.GROUPS_CONFIG.read_text())
PAGE = """<html><body><p>Der Gebotstermin ist der 1. August 2026 .</p>
<p>Der Höchstwert für diesen Gebotstermin beträgt 7,25 Cent pro Kilowattstunde.</p>
<p>Das Ausschreibungsvolumen beträgt 2.520.129 Kilowatt.</p>
<p>Der niedrigste Gebotswert eines Gebotes, das einen Zuschlag erhielt, beträgt 4,49 ct/kWh .
Der höchste Gebotswert eines Gebotes, das einen Zuschlag erhielt, beträgt 4,98 ct/kWh .
Der durchschnittliche, mengengewichtete Zuschlagswert beträgt 4,79 ct/kWh .
Es wurden 3 Gebote mit einem Gebotsvolumen von 19.000 kW bezuschlagt.
Mit dieser Veröffentlichung am 17. September 2026 ist die Bekanntgabe erfolgt.</p>
<script>var x = "Zuschlagswert beträgt 9,99 ct/kWh";</script></body></html>"""

HEADER_C = [
    "Name des Bieters",
    "Gebots-Nr",
    "Zuschlags-Nr",
    "Gebotsmenge",
    "Angegebener Standort der Anlage",
    "Bekanntgabe",
]
HEADER_D = [
    "Name des Bieters",
    "Gebots-Nr",
    "Zuschlags-Nr",
    "Bundesland",
    "Landkreis",
    "Postleitzahl",
    "Gemeinde",
    "Gemarkung",
    "Flur / Flurstück",
    "Registernummer",
]
AWARDS = [
    (
        "wpd Windpark Nr. 1 GmbH & Co. KG",
        "WIN26-3/001",
        12000,
        ["EEG900000000001", "EEG900000000002"],
    ),
    ("Stadtwerke Musterstadt GmbH", "WIN26-3/002", 4000, ["EEG900000000003"]),
    (
        "Erika Mustermann",
        "WIN26-3/003",
        3000,
        ["SEE900000000009"],
    ),  # a natural person: name withheld
]


def write_list(path):
    wb = openpyxl.Workbook()
    c = wb.active
    c.title = "Zuschläge_Kompakt"
    c.append(["Zuschläge … Gebotstermin 01.08.2026"])
    c.append([])
    c.append(HEADER_C)
    for bidder, no, kw, _ in AWARDS:
        c.append([bidder, None, no, kw, "…", None])
    d = wb.create_sheet("Zuschläge_Detailliert")
    d.append(HEADER_D)
    for bidder, no, _, regs in AWARDS:
        for r in regs:
            d.append([bidder, None, no, "Niedersachsen", "", "", "", "", "", r])
    wb.save(path)


def write_grid(cache):
    """A one-cell DWD grid covering Germany: 6.5 m/s at 100 m, 6.2 at 80 m, k = 2."""
    (cache / "dwd").mkdir(exist_ok=True)
    one = lambda v: np.array([[v]], dtype=np.int16)  # noqa: E731
    np.savez_compressed(
        cache / "dwd" / "dwd_wind_grids.npz", v100=one(65), v80=one(62), k80=one(2000),
        hdr_ncols=1, hdr_nrows=1, hdr_xllcorner=3_000_000, hdr_yllcorner=5_000_000,
        hdr_cellsize=1_000_000,
    )  # fmt: skip


OLD_PAGE = """<p>Ge&shy;bots&shy;ter&shy;min 1. Juni 2020</p><p>Es werden 61 Gebote mit einer
Gebotsmenge von 463.990 kW bezuschlagt. Der niedrigste und der höchste Gebotswert von Geboten,
die einen Zuschlag in dieser Runde erhalten werden, liegen bei 5,90 ct/kWh bzw. 6,20 ct/kWh .
Der durchschnittliche, mengengewichtete Zuschlagswert (vor Eingang der Zweitsicherheiten)
entspricht 6,14 ct/kWh .</p><p>Kurzübersicht Ausschreibungs- volumen Höchstwert 2. Juni 2020
825.527 kW 6,20 ct/kWh</p>"""


def test_parse_old_round_page():
    r = auctions.parse_round_page(OLD_PAGE)
    assert (r["bid_date"], r["min_ct"], r["max_ct"], r["avg_ct"]) == ("2020-06-01", 5.9, 6.2, 6.14)
    assert (r["awards"], r["awarded_kw"], r["ceiling_ct"]) == (61, 463990, 6.2)


def test_parse_list_without_kw(tmp_path):
    """Lists before 2022 have no kW column; turbines sit in the site text."""
    wb = openpyxl.Workbook()
    c = wb.active
    c.append(["Name des Bieters", "Gebots-Nr.", "Zuschlags-Nr.", "Kassenzeichen",
              "Angegebener Standort der Anlage (Anlagennummer)"])  # fmt: skip
    c.append(["BOREAS Energie GmbH", "1", "WIN21-1/042", "1",
              "Thüringen, Gotha:_x000D_\nFlur 5 (SEE980023540885) (SEE980023540886)"])  # fmt: skip
    c.append(["Hinweis: …", None, None, None, None])
    wb.save(tmp_path / "old.xlsx")
    [a] = auctions.parse_award_list(tmp_path / "old.xlsx")
    assert a["kw"] is None and a["state"] == "Thüringen"
    assert a["turbines"] == ["SEE980023540885", "SEE980023540886"]


def test_parse_round_page():
    r = auctions.parse_round_page(PAGE)
    assert r == {
        "bid_date": "2026-08-01",
        "published": "2026-09-17",
        "ceiling_ct": 7.25,
        "volume_kw": 2520129,
        "min_ct": 4.49,
        "max_ct": 4.98,
        "avg_ct": 4.79,
        "awards": 3,
        "awarded_kw": 19000,
    }


@pytest.mark.parametrize(
    ("bidder", "group", "category"),
    [
        ("wpd Windpark Nr. 440 GmbH & Co. KG", "wpd", "developer"),
        ("UKA Umweltgerechte Kraftanlagen GmbH & Co. KG", "UKA", "developer"),
        ("Stadtwerke Münster GmbH", "Stadtwerke (other)", "municipal"),
        ("enercity Windpark Schleife GmbH & Co. KG", "enercity", "municipal"),
        ("Alterric Deutschland GmbH", "Alterric", "developer"),
        ("RWE Wind Onshore & PV Deutschland GmbH", "RWE", "utility"),
        ("EnBW Windkraftprojekte GmbH", "EnBW", "utility"),
        ("2. Bürgerwindpark Norstedt GmbH & Co. KG", "Citizen wind farms", "citizen"),
        ("Windpark Birstein GmbH", None, "unattributed"),
    ],
)
def test_attribute(bidder, group, category):
    assert auctions.attribute(bidder, CFG) == (group, category)


def test_legal_entity():
    assert auctions.is_legal_entity("Prowind GmbH", CFG)
    assert auctions.is_legal_entity("PROKON Regenerative Energien eG", CFG)
    assert not auctions.is_legal_entity("Erika Mustermann", CFG)
    assert not auctions.is_legal_entity("Müller und Schmidt GbR", CFG)


def test_build_and_check(tmp_path):
    cache = tmp_path / "auctions"
    cache.mkdir()
    (cache / "R1.html").write_text(PAGE, encoding="utf-8")
    write_list(cache / "R1.xlsx")
    write_grid(cache)
    rows = []
    for i, reg in enumerate(["EEG900000000001", "EEG900000000002", "EEG900000000003"]):
        u = unit(f"SEE{i}", kw=6000, cod=None, status="planned")
        u.update(
            eeg_id=reg,
            manufacturer="Vestas",
            turbine_model="V162-6.2",
            lat=52.5,
            lon=9.5,
            hub_height_m=160.0,
            rotor_diameter_m=162.0,
        )
        rows.append(u)
    u = unit("SEE900000000009", kw=3000, cod=date(2026, 9, 1))
    u.update(
        manufacturer="ENERCON GmbH",
        turbine_model="E-160 EP5",
        lat=52.5,
        lon=9.5,
        hub_height_m=120.0,
        rotor_diameter_m=115.0,
    )
    rows.append(u)
    units = write_units(tmp_path / "units.parquet", rows)
    out = tmp_path / "data"
    rounds = [{"id": "R1", "path": "2026/R1/start.html"}]
    entries = auctions.build(rounds, cache, units, out)
    assert {e["name"] for e in entries} == {"auctions/onshore.json", "auctions/awards.json"}
    auctions.check(out, rounds)

    onshore = json.loads((out / "auctions" / "onshore.json").read_text())
    r = onshore["rounds"][0]
    assert r["kw_by_category"] == {
        "developer": 12000,
        "utility": 0,
        "municipal": 4000,
        "citizen": 0,
        "unattributed": 3000,
    }
    assert r["kw_by_maker"] == {"Vestas": 18000, "Enercon": 3000}
    assert (r["turbines"], r["turbines_in_mastr"], r["turbines_operating"]) == (4, 4, 1)
    # Buckets are ranked too, flagged, under a display name.
    ranked = [(w["group"], w["bucket"]) for w in onshore["winners_by_year"]["2026"]]
    assert ranked == [("wpd", False), ("Other Stadtwerke", True), ("Not attributed", True)]
    assert onshore["race"]["kw"]["wpd"] == [12000]
    # Yield: 6.5 m/s at 100 m on the test grid.
    assert 2000 < r["full_load_hours_avg"] < 4000
    assert (
        r["merit_order"]
        if False
        else onshore["merit_order"]["R1"][0][1] >= onshore["merit_order"]["R1"][-1][1]
    )
    assert r["received_ct_est"] == pytest.approx(4.79 * r["correction_factor_avg"], abs=0.01)

    awards = json.loads((out / "auctions" / "awards.json").read_text())["awards"]
    assert awards[0]["model"] == "V162" and awards[0]["maker"] == "Vestas"
    assert awards[2]["bidder"] is None and awards[2]["lat"] is None  # natural person (D4)
    assert awards[0]["lat"] == 52.5


def test_check_fails_on_bad_prices(tmp_path):
    cache = tmp_path / "auctions"
    cache.mkdir()
    (cache / "R1.html").write_text(PAGE.replace("4,98", "8,10"), encoding="utf-8")
    write_list(cache / "R1.xlsx")
    units = write_units(tmp_path / "units.parquet", [unit("X", kw=1)])
    write_grid(cache)
    rounds = [{"id": "R1", "path": "x"}]
    auctions.build(rounds, cache, units, tmp_path / "data")
    with pytest.raises(auctions.AuctionCheckError, match="prices out of order"):
        auctions.check(tmp_path / "data", rounds)
