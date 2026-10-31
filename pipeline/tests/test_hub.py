"""Data hub (contract v1.4 draft): day files from a fake SMARD cache, no network."""

import json
import zipfile
from datetime import date

import numpy as np
import pytest

from mastr_radar import hub
from mastr_radar.config import load_settings

S = load_settings().hub
REGIONS = list(S.smard_regions)
TSOS = [r for r in REGIONS if r != "DE"]


def fake_cache(days: list[date], *, solar_peak=4000.0, gaps=None, absent=()):
    """MWh per quarter hour for every series; DE = sum of the four grid areas."""
    gaps = gaps or {}
    cache = {}
    names = [f"gen:{t}" for t in S.smard_generation] + ["demand", "residual_load"]
    for name in names:
        for region in REGIONS:
            if (name, region) in absent:
                cache[(name, region)] = hub._Zero()
                continue
            values = {}
            share = 1.0 if region == "DE" else 0.25
            for d in days:
                slots = hub.day_slots(d)
                for i, t in enumerate(slots):
                    hour = i / 4
                    if name == "gen:solar":
                        v = (
                            max(0.0, solar_peak * (1 - abs(hour - 12) / 6))
                            if 6 < hour < 18
                            else 0.0
                        )
                    elif name == "demand":
                        v = 15000.0
                    else:
                        v = 1000.0
                    values[t] = v * share
            for t in gaps.get((name, region), []):
                values[t] = None
            cache[(name, region)] = values
    return cache


def test_day_length_follows_clock_changes():
    assert len(hub.day_slots(date(2026, 3, 29))) == 92  # summer time starts
    assert len(hub.day_slots(date(2026, 6, 21))) == 96
    assert len(hub.day_slots(date(2026, 10, 25))) == 100  # summer time ends


def test_build_day_converts_mwh_to_mw():
    d = date(2026, 6, 21)
    day = hub.build_day(d, fake_cache([d]), S)
    assert day["slots"] == 96
    assert day["demand_mw"]["DE"][0] == 60000  # 15 000 MWh per quarter hour × 4
    assert max(day["generation_mw"]["DE"]["solar"]) == 16000
    assert "nuclear" not in day["generation_mw"]["DE"]
    assert day["sources"] == ["Bundesnetzagentur | SMARD.de", "Deutscher Wetterdienst"]


def test_absent_series_is_zero():
    d = date(2026, 6, 21)
    cache = fake_cache([d], absent={("gen:wind_offshore", "Amprion")})
    day = hub.build_day(d, cache, S)
    assert set(day["generation_mw"]["Amprion"]["wind_offshore"]) == {0}


def test_night_solar_spike_is_cleaned():
    d = date(2026, 1, 11)
    cache = fake_cache([d])
    midnight = hub.day_slots(d)[0]
    cache[("gen:solar", "DE")][midnight] = 360.0  # the kind of error SMARD has
    day = hub.build_day(d, cache, S)
    assert day["generation_mw"]["DE"]["solar"][0] is None
    assert day["cleaned_values"] == 1


def test_incomplete_day_is_skipped_and_others_written(tmp_path, monkeypatch):
    days = [date(2026, 10, 27), date(2026, 10, 28)]
    slots = hub.day_slots(days[1])[:30]  # 30 of 96 quarter hours missing
    cache = fake_cache(days, gaps={("gen:hard_coal", "DE"): slots})
    monkeypatch.setattr(hub, "load_cache", lambda *a: cache)
    settings = S.__class__(**{**S.__dict__, "keep_days": 2})
    result = hub.build_days(settings, tmp_path / "cache", tmp_path, today=date(2026, 10, 29))
    assert result["written"] == 1 and result["skipped"] == ["2026-10-28"]
    index = json.loads((tmp_path / "days" / "index.json").read_text())
    assert index["dates"] == ["2026-10-27"]
    assert index["contract_version"] == "1.4"
    hub.check_days(tmp_path, settings)


def test_check_catches_broken_files(tmp_path, monkeypatch):
    d = date(2026, 10, 27)
    cache = fake_cache([d])
    monkeypatch.setattr(hub, "load_cache", lambda *a: cache)
    settings = S.__class__(**{**S.__dict__, "keep_days": 1})
    hub.build_days(settings, tmp_path / "cache", tmp_path, today=date(2026, 10, 28))
    path = tmp_path / "days" / "2026-10-27.json"
    day = json.loads(path.read_text())
    day["demand_mw"]["TenneT"] = [
        v * 3 for v in day["demand_mw"]["TenneT"]
    ]  # areas no longer add up
    day["slots"] = 95
    path.write_text(json.dumps(day))
    with pytest.raises(hub.HubCheckError) as err:
        hub.check_days(tmp_path, settings)
    assert "95 slots" in str(err.value)
    assert "do not add up" in str(err.value)


# --- DWD weather ---------------------------------------------------------------

STATIONS_TXT = """Stations_id von_datum bis_datum Stationshoehe geoBreite geoLaenge Stationsname Bundesland Abgabe
----------- --------- --------- ------------- --------- --------- ----------------------------------------- ---------- ------
00044 20070402 20261030             44     52.9336    8.2370 Großenkneten                             Niedersachsen                            Frei
00183 19911101 20261031             42     54.6791   13.4344 Kap Arkona                               Mecklenburg-Vorpommern                   Frei
"""


def write_dwd(tmp, kind, rows_by_station):
    d = tmp / kind
    d.mkdir(parents=True, exist_ok=True)
    (d / "stations.txt").write_text(STATIONS_TXT, encoding="latin-1")
    for sid, rows in rows_by_station.items():
        header = (
            "STATIONS_ID;MESS_DATUM;  QN;DS_10;GS_10;SD_10;LS_10;eor\n"
            if kind == "solar"
            else "STATIONS_ID;MESS_DATUM;QN_3;   F;   D;eor\n"
        )
        with zipfile.ZipFile(d / f"x_{sid}_akt.zip", "w") as zf:
            zf.writestr(f"produkt_{sid}.txt", header + "".join(rows))


def test_dwd_parsing_and_weather_block(tmp_path):
    from datetime import UTC, datetime, timedelta

    day = date(2026, 6, 21)
    start = datetime(2026, 6, 20, 0, tzinfo=UTC)
    # Solar station 44: 60 J/cm² per 10 min at 10 UTC (= 1000 W/m²), only 3 values at 11 UTC.
    solar_rows = []
    for h in range(48):
        t = start + timedelta(hours=h)
        for m in range(0, 60, 10):
            v = 60.0 if t.hour == 10 else 0.0
            if t.hour == 11 and m >= 30:
                v = -999
            solar_rows.append(f"44;{t:%Y%m%d%H}{m:02d};3;-999;{v};0;-999;eor\n")
    wind_rows = [
        f"183;{(start + timedelta(hours=h)):%Y%m%d%H};10;{4.5 if h % 2 else -999};270;eor\n"
        for h in range(48)
    ]
    write_dwd(tmp_path, "solar", {"44": solar_rows})
    write_dwd(tmp_path, "wind", {"183": wind_rows})

    stations = hub.read_stations(tmp_path / "solar" / "stations.txt")
    assert stations["44"] == (52.9336, 8.237, "Großenkneten")
    assert stations["183"][2] == "Kap Arkona"

    start_ms = int(start.timestamp() * 1000)
    solar = hub.read_dwd_series(tmp_path, "solar", start_ms, 48)
    assert round(solar["44"][34]) == 1000  # 21 Jun 10:00 UTC
    assert np.isnan(solar["44"][35])  # 11 UTC: only 3 of 6 values

    weather = {
        "start_ms": start_ms,
        "solar": solar,
        "wind": hub.read_dwd_series(tmp_path, "wind", start_ms, 48),
    }
    block = hub.weather_block(day, weather)
    assert block["hours"] == 24
    assert block["solar_stations"] == ["44"]
    assert block["radiation_wm2"][0][12] == 1000  # 12:00 local = 10:00 UTC
    assert block["wind_stations"] == []  # wind station has 50 % gaps: left out
