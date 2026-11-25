"""Cost benchmarks (contract v1.11): build and check on the real config."""

import copy
import json

import pytest
import yaml

from mastr_radar import costs


@pytest.fixture
def built(tmp_path):
    out = tmp_path / "data"
    (out / "auctions").mkdir(parents=True)
    rounds = [
        {"bid_date": "2025-02-01", "avg_ct": 7.0, "awarded_kw": 1},
        {"bid_date": "2025-05-01", "avg_ct": 6.0, "awarded_kw": 1},
    ]
    (out / "auctions" / "onshore.json").write_text(json.dumps({"rounds": rounds}))
    solar = [
        {"bid_date": "2025-03-01", "avg_ct": 4.7, "programme": "solar"},
        {"bid_date": "2025-05-01", "avg_ct": 6.1, "programme": "innovation"},
    ]
    (out / "auctions" / "solar.json").write_text(json.dumps({"rounds": solar}))
    files = costs.build(out)
    return out, files, json.loads((out / costs.FILE).read_text())


def test_build_and_check(built):
    out, files, d = built
    assert files[0]["name"] == costs.FILE
    costs.check(out)
    assert set(d["sources"]) == {"windguard", "ise", "dea", "irena"}


def test_breakdowns(built):
    _, _, d = built
    wind = d["wind_onshore"]["capex_breakdown"]
    assert wind["total"] == 1235 + 506
    turbine = wind["groups"][0]["components"]
    assert [c["value"] for c in turbine] == [914, 86, 235]  # shares of 1,235
    solar = d["solar"]["capex_breakdown"]
    assert sum(c["value"] for c in solar["components"]) == solar["total"] == 458


def test_conversions(built):
    _, _, d = built
    rows = {r["label"]: r for r in d["wind_onshore"]["capex_compare"]}
    irena = rows["IRENA, Germany"]
    assert irena["eur_value"] == round(1670 / 1.0824, 1)
    assert "USD→EUR" in irena["conversion"]
    dea = rows["Danish Energy Agency, total"]
    assert dea["eur_value"] == round(1185 * 0.982 / 0.856, 1)
    ise = {r["label"]: r for r in d["wind_onshore"]["opex_compare"]}["Fraunhofer ISE"]
    assert ise["eur_value_incl_variable"] == 32 + 7 * 2.5


def test_auction_link(built):
    _, _, d = built
    assert d["wind_onshore"]["auction_link"]["years"] == [
        {"year": 2025, "avg_ct": 6.5, "rounds": 2}
    ]
    assert d["solar"]["auction_link"]["years"] == [{"year": 2025, "avg_ct": 4.7, "rounds": 1}]


def _broken(tmp_path, change):
    raw = yaml.safe_load(costs.COSTS_PATH.read_text())
    raw = copy.deepcopy(raw)
    change(raw)
    p = tmp_path / "costs.yaml"
    p.write_text(yaml.safe_dump(raw, allow_unicode=True))
    out = tmp_path / "out"
    out.mkdir()
    with pytest.raises(costs.CostsCheckError) as err:
        costs.build(out, p)
    return str(err.value)


def test_check_catches_bad_sum(tmp_path):
    def change(r):
        r["solar"]["capex_breakdown"]["components"][0]["value"] += 50

    assert "sums to" in _broken(tmp_path, change)


def test_check_catches_chart_read_without_tolerance(tmp_path):
    def change(r):
        del r["wind_onshore"]["capex_trend"][0]["tolerance"]

    assert "tolerance" in _broken(tmp_path, change)


def test_check_catches_unknown_source_and_bad_range(tmp_path):
    def change(r):
        r["solar"]["capex_compare"][1]["source"] = "nobody"
        r["solar"]["capex_compare"][1]["low"] = 2000

    msg = _broken(tmp_path, change)
    assert "unknown source" in msg and "low above high" in msg


def test_check_catches_missing_fx(tmp_path):
    def change(r):
        r["fx_usd_per_eur"] = {2023: 1.08}

    with pytest.raises(KeyError):
        # conversion needs the rate; build fails before writing anything
        _broken(tmp_path, change)
