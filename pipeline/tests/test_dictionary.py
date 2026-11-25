import json

import pyarrow as pa
import pyarrow.parquet as pq

from mastr_radar import dictionary


def test_dictionary_matches_files(tmp_path):
    pq.write_table(pa.table({"a": [1], "b": ["x"]}), tmp_path / "t.parquet")
    (tmp_path / "s.json").write_text(json.dumps({"as_of": "2026-11-25", "rows": []}))
    d = {
        "licences": {"mastr": {}},
        "datasets": [
            {
                "file": "t.parquet",
                "title": "T",
                "grain": "row",
                "licence": "mastr",
                "fields": {"a": "A", "b": "B"},
            },
            {
                "file": "s.json",
                "title": "S",
                "grain": "file",
                "licence": "mastr",
                "fields": {"as_of": "x"},
            },
        ],
    }
    problems = dictionary.problems_for(d, tmp_path, ["t.parquet", "s.json"])
    assert problems == ["s.json: undescribed ['rows']."]
    d["datasets"][1]["fields"]["rows"] = "r"
    d["datasets"][0]["fields"]["old"] = "gone"
    assert dictionary.problems_for(d, tmp_path, ["t.parquet", "s.json"]) == [
        "t.parquet: dictionary describes fields that no longer exist ['old']."
    ]


def test_real_dictionary_is_valid_yaml():
    import yaml

    d = yaml.safe_load(dictionary.DICT_PATH.read_text())
    files = [e["file"] for e in d["datasets"]]
    assert len(files) == len(set(files)) and "units.parquet" in files
