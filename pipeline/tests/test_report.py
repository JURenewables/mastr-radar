import json

from mastr_radar.report import markdown_summary


def test_summary(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"as_of": "2026-10-30"}))
    kpis = [
        {
            "technology": "wind_onshore",
            "installed_capacity_kw": 71_544_162.9,
            "installed_units": 30435,
            "planned_capacity_kw": 53_976_152.8,
            "added_capacity_kw_ytd": 4_244_583.9,
        }
    ]
    (tmp_path / "kpis.json").write_text(json.dumps(kpis))
    cc = {
        "rows": [
            {
                "technology": "wind_onshore",
                "ours_gw": 71.544,
                "energy_charts_gw": 71.618,
                "diff_pct": -0.1,
                "ok": True,
            }
        ],
        "warnings": ["Energy-Charts has no value for 'Biomass'."],
    }
    (tmp_path / "cc.json").write_text(json.dumps(cc))
    md = markdown_summary(tmp_path, tmp_path / "cc.json")
    assert "data as of 2026-10-30" in md
    assert "| Onshore wind | 71.54 GW | 30,435 | 4.24 GW | 53.98 GW |" in md
    assert "✅ -0.1%" in md
    assert "⚠️ Energy-Charts has no value" in md


def test_summary_without_crosscheck(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"as_of": "2026-10-30"}))
    (tmp_path / "kpis.json").write_text("[]")
    assert "Cross-check" not in markdown_summary(tmp_path, tmp_path / "missing.json")
