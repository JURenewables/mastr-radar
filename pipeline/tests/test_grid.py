from datetime import date

import pandas as pd
import pytest

from mastr_radar import grid


def _write(tmp, name, rows):
    pd.DataFrame(rows).to_parquet(tmp / name)


def test_grid_build_small(tmp_path, monkeypatch):
    ex = tmp_path / "extract"
    ex.mkdir()
    units, details, gu = [], [], []
    for i in range(400):
        uid = f"U{i}"
        area = grid.AREAS[i % 4]
        units.append(
            {
                "unit_id": uid,
                "status": "operating",
                "capacity_kw": 1000.0,
                "district_key": f"{i:05d}",
            }
        )
        details.append({"unit_id": uid, "technology": "wind_onshore" if i % 2 else "solar"})
        gu.append(
            {
                "unit_id": uid,
                "grid_operator_id": f"SNB{i % 7}",
                "control_area": area,
                "voltage": "medium",
            }
        )
    _write(ex, "units.parquet", units)
    _write(ex, "unit_details.parquet", details)
    _write(ex, "grid_units.parquet", gu)
    ops = [{"operator_id": f"SNB{i}", "tso": i < 4, "dso": True} for i in range(600)]
    _write(ex, "grid_operators.parquet", ops)
    _write(ex, "operators.parquet", [{"operator_id": "SNB0", "name": "Netz A"}])
    cons = [
        {
            "unit_id": "C1",
            "status": "planned",
            "state": "Bayern",
            "lat": 48.1,
            "lon": 11.5,
            "units_over_50mw": 1,
            "planned_date": date(2027, 1, 1),
            "control_area": "TenneT",
        },
        {
            "unit_id": "C2",
            "status": "operating",
            "state": "Hessen",
            "lat": 50.1,
            "lon": 8.6,
            "units_over_50mw": None,
            "planned_date": None,
            "control_area": "Amprion",
        },
    ]
    _write(ex, "consumers.parquet", cons)
    facts = tmp_path / "f.yaml"
    facts.write_text("congestion:\n  - {year: 2025, cost_meur: 3071, source: 'https://x.y'}\n")
    out = tmp_path / "web"
    grid.build(ex, out, date(2026, 10, 30), facts)
    import json

    d = json.loads((out / grid.FILE).read_text())
    assert d["coverage_share"] == 1.0
    assert d["operators"]["with_large_units"] == 7
    assert d["consumers"]["planned"] == 1 and len(d["consumers"]["points"]) == 8
    assert (
        d["operators"]["top"][0]["kw"]["wind_onshore"] + d["operators"]["top"][0]["kw"]["solar"] > 0
    )


def test_grid_check_rejects_missing_source():
    d = {
        "control_areas": [{"name": a} for a in grid.AREAS],
        "coverage_share": 0.9,
        "operators": {"tsos": 4, "registered": 900},
        "districts": {str(i): [0, 1, 0] for i in range(400)},
        "consumers": {"points": []},
        "context": {"facts": [{"text": "x", "source": "none"}]},
    }
    with pytest.raises(grid.GridCheckError, match="source"):
        grid.check_data(d)
