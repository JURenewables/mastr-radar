"""Hubs, infrastructure helpers and champions (contract v1.13) on tiny fixtures."""

import datetime
import json

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from mastr_radar import assets_extract, hubs, infra, players
from mastr_radar.extract import UNITS_SCHEMA


def _unit(uid, tech, lat, lon, kw=3000.0, solar_type=None):
    row = dict.fromkeys(UNITS_SCHEMA.names)
    row.update(
        unit_id=uid, technology=tech, status="operating", capacity_kw=kw, lat=lat, lon=lon,
        state="Niedersachsen", district="X", operator_is_person=False, operator_name="Co GmbH",
        solar_type=solar_type,
    )  # fmt: skip
    return row


def _asset(uid, kind, lat, lon, kw=None):
    r = dict.fromkeys(assets_extract.SCHEMA.names)
    r.update(unit_id=uid, kind=kind, status="operating", capacity_kw=kw, lat=lat, lon=lon,
             state="Niedersachsen", district="X", operator_is_person=False,
        operator_name="Gas AG",
    )  # fmt: skip
    return r


def _extract(tmp_path, units, assets):
    ex = tmp_path / "extract"
    ex.mkdir()
    pq.write_table(pa.Table.from_pylist(units, UNITS_SCHEMA), ex / "units.parquet")
    pq.write_table(pa.Table.from_pylist(assets, assets_extract.SCHEMA), ex / "assets_other.parquet")
    return ex


def test_hub_needs_three_types(tmp_path, monkeypatch):
    units = [
        _unit("W1", "wind_onshore", 53.0, 8.0),
        _unit("S1", "solar", 53.005, 8.0, kw=5000, solar_type="ground_mounted"),
        _unit("B1", "storage", 53.0, 8.005, kw=2000),
        _unit("B2", "storage", 54.0, 9.0, kw=2000),  # alone: no hub
    ]
    assets = [
        _asset("G1", "gas_plant", 53.002, 8.002, kw=20000),
        _asset("C1", "large_consumer", 54.5, 9.5),
    ]
    ex = _extract(tmp_path, units, assets)
    out = tmp_path / "data"
    monkeypatch.setattr(
        hubs, "_validate", lambda d: None
    )  # fixture is smaller than the real minimum
    hubs.build(ex, out, datetime.date(2026, 11, 26))
    d = json.loads((out / hubs.FILE).read_text())
    assert d["totals"]["hubs"] == 1
    h = d["hubs"][0]
    assert h["types"] == ["wind", "solar", "battery", "gas_plant"]
    assert h["parts"]["gas_plant"]["mw"] == 20.0


def test_infra_helpers():
    assert infra.substation_place("UW Dörpen-West") == "Dörpen"
    assert infra.substation_place("UW Garrel-Ost") == "Garrel"
    pts = infra._wkt_line("'LINESTRING (6.0 50.0, 6.5 50.5, 7.0 51.0)'")
    assert pts == [[6.0, 50.0], [6.5, 50.5], [7.0, 51.0]]
    assert infra._wkt_line("'LINESTRING (6.0 50") == []
    ring = [[6.0, 50.0], [7.0, 50.0], [7.0, 51.0], [6.0, 51.0], [6.0, 50.0]]
    assert infra._inside(6.5, 50.5, [ring]) and not infra._inside(8.0, 50.5, [ring])
    gaz = {"esslingen am neckar": (9.3, 48.74), "leipzig": (12.37, 51.34)}
    assert infra.geocode("Esslingen", gaz) == (9.3, 48.74)
    assert infra.geocode("Mockau Nord", gaz, {"Mockau Nord": [12.4, 51.38]}) == (12.4, 51.38)
    assert infra.geocode("Nowhere", gaz) is None


def test_champions(tmp_path):
    out = tmp_path / "data"
    (out / "auctions").mkdir(parents=True)
    awards = []
    for g, n, months in (("Alpha", 6, 15), ("Beta", 3, 30)):
        for i in range(n):
            awards.append(
                {
                    "group": g,
                    "kw": 50000,
                    "bid_date": f"2025-0{1 + i % 6}-01",
                    "kw_operating": 0,
                    "months_to_operation": months,
                }
            )
    awards.append({"group": "Citizen wind farms", "kw": 900000, "bid_date": "2025-05-01"})
    (out / "auctions" / "awards.json").write_text(json.dumps({"awards": awards}))
    (out / "auctions" / "solar_awards.json").write_text(
        json.dumps(
            {
                "awards": [
                    {"group": "Alpha", "programme": "solar", "kw": 20000, "bid_date": "2025-03-01"}
                ]
            }
        )
    )
    c = players.champions(out, [], "2026-11-26")
    groups = [r["group"] for r in c["rows"]]
    assert groups[0] == "Alpha" and "Citizen wind farms" not in groups
    alpha = c["rows"][0]
    assert alpha["technologies"] == ["solar", "wind"] and alpha["scores"]["breadth"] == 67
    assert alpha["scores"]["scale"] == 100  # leader
    assert alpha["scores"]["execution"] > c["rows"][1]["scores"]["execution"]
    assert all(v is None or 0 <= v <= 100 for r in c["rows"] for v in r["scores"].values())


def test_players_accept_not_published():
    base = {
        "name": "X",
        "type": "developer",
        "momentum": "steady",
        "why": "w",
        "sources": ["https://x.org"],
    }
    players.check_data({"players": [{**base, "revenue": "not_published"}]})
    with pytest.raises(players.PlayersCheckError):
        players.check_data({"players": [{**base, "revenue": "lots"}]})
