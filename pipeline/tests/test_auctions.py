"""Auctions (contract v1.5 draft) on a tiny hand-made round page and award list."""

import json
from datetime import date

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
    "Standort",
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
    ("wpd Windpark Nr. 1 GmbH & Co. KG", "W/1", 12000, ["EEG1", "EEG2"]),
    ("Stadtwerke Musterstadt GmbH", "W/2", 4000, ["EEG3"]),
    ("Erika Mustermann", "W/3", 3000, ["SEE9"]),  # a natural person: name withheld
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
        ("Stadtwerke Münster GmbH", "Stadtwerke (other)", "utility"),
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
    rows = []
    for i, reg in enumerate(["EEG1", "EEG2", "EEG3"]):
        u = unit(f"SEE{i}", kw=6000, cod=None, status="planned")
        u.update(eeg_id=reg, manufacturer="Vestas", turbine_model="V162-6.2")
        rows.append(u)
    u = unit("SEE9", kw=3000, cod=date(2026, 9, 1))
    u.update(manufacturer="ENERCON GmbH", turbine_model="E-160 EP5")
    rows.append(u)
    units = write_units(tmp_path / "units.parquet", rows)
    out = tmp_path / "data"
    rounds = [{"id": "R1", "year": 2026}]
    entries = auctions.build(rounds, cache, units, out)
    assert {e["name"] for e in entries} == {"auctions/onshore.json", "auctions/awards.json"}
    auctions.check(out, rounds)

    onshore = json.loads((out / "auctions" / "onshore.json").read_text())
    r = onshore["rounds"][0]
    assert r["kw_by_category"] == {
        "developer": 12000,
        "utility": 4000,
        "citizen": 0,
        "unattributed": 3000,
    }
    assert r["kw_by_maker"] == {"Vestas": 18000, "Enercon": 3000}
    assert (r["turbines"], r["turbines_in_mastr"], r["turbines_operating"]) == (4, 4, 1)
    # Buckets such as "Stadtwerke (other)" are not ranked as winners.
    assert [w["group"] for w in onshore["winners_by_year"]["2026"]] == ["wpd"]

    awards = json.loads((out / "auctions" / "awards.json").read_text())["awards"]
    assert awards[0]["model"] == "V162" and awards[0]["maker"] == "Vestas"
    assert awards[2]["bidder"] is None  # natural person withheld (D4)


def test_check_fails_on_bad_prices(tmp_path):
    cache = tmp_path / "auctions"
    cache.mkdir()
    (cache / "R1.html").write_text(PAGE.replace("4,98", "8,10"), encoding="utf-8")
    write_list(cache / "R1.xlsx")
    units = write_units(tmp_path / "units.parquet", [unit("X", kw=1)])
    rounds = [{"id": "R1", "year": 2026}]
    auctions.build(rounds, cache, units, tmp_path / "data")
    with pytest.raises(auctions.AuctionCheckError, match="prices out of order"):
        auctions.check(tmp_path / "data", rounds)
