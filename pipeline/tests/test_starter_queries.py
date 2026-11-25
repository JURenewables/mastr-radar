"""Every starter query in the data dictionary runs against the published files."""

from pathlib import Path

import pytest
import yaml

from mastr_radar import dictionary

duckdb = pytest.importorskip("duckdb")
DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


@pytest.mark.skipif(not (DATA / "units.parquet").exists(), reason="published files not present")
@pytest.mark.parametrize(
    "item",
    yaml.safe_load(dictionary.DICT_PATH.read_text())["starter_queries"],
    ids=lambda i: i["q"][:40],
)
def test_starter_query_runs(item):
    rows = duckdb.connect().execute(item["sql"].replace("{data}", f"{DATA}/")).fetchall()
    assert rows, f"no rows for: {item['q']}"
