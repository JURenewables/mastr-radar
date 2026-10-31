"""Cross-check tests with fake Energy-Charts data (no network)."""

import json
from datetime import date

import requests

from mastr_radar import crosscheck
from mastr_radar.config import load_settings

SETTINGS = load_settings().crosscheck
AS_OF = date(2026, 10, 30)
EC = {
    "time": ["09.2026", "10.2026"],
    "last_update": 1793349360,
    "production_types": [
        {"name": "Wind onshore", "data": [71.3, 71.618]},
        {"name": "Wind offshore", "data": [11.6, 11.644]},
        {"name": "Solar DC", "data": [131.0, 132.1]},
    ],
}
KPIS = [
    {"technology": "wind_onshore", "installed_capacity_kw": 71_544_000.0},
    {"technology": "wind_offshore", "installed_capacity_kw": 11_644_000.0},
]


def test_close_numbers_pass():
    result = crosscheck.compare(KPIS, EC, AS_OF, SETTINGS)
    assert result["compared_month"] == "10.2026"
    assert [r["technology"] for r in result["rows"]] == ["wind_onshore", "wind_offshore"]
    assert all(r["ok"] for r in result["rows"])
    assert result["warnings"] == []  # solar not extracted yet → skipped, not a warning


def test_big_gap_warns():
    kpis = [{"technology": "wind_onshore", "installed_capacity_kw": 60_000_000.0}]
    result = crosscheck.compare(kpis, EC, AS_OF, SETTINGS)
    assert result["rows"][0]["ok"] is False
    assert "wind_onshore" in result["warnings"][0]


def test_missing_month_uses_latest():
    result = crosscheck.compare(KPIS, EC, date(2026, 12, 1), SETTINGS)
    assert result["compared_month"] == "10.2026"
    assert "no data for 12.2026" in result["warnings"][0]


def test_network_error_is_only_a_warning(tmp_path, monkeypatch):
    def boom(_settings):
        raise requests.ConnectionError("unreachable")

    monkeypatch.setattr(crosscheck, "fetch", boom)
    kpis_path = tmp_path / "kpis.json"
    kpis_path.write_text(json.dumps(KPIS))
    result = crosscheck.run(kpis_path, AS_OF, SETTINGS, tmp_path / "reports" / "cc.json")
    assert result["rows"] == []
    assert "Cross-check skipped" in result["warnings"][0]
    assert (tmp_path / "reports" / "cc.json").exists()
