"""Snapshot index (contract v1.10, WP78)."""

import json

import pytest

from mastr_radar import snapshots


def _out(tmp_path, as_of="2026-11-25"):
    (tmp_path / "manifest.json").write_text(json.dumps({"as_of": as_of, "files": []}))
    return tmp_path


def test_build_index(tmp_path):
    out = _out(tmp_path)
    rel = [
        {"tagName": "data-2026-11-24", "name": "Data 2026-11-24", "publishedAt": "x"},
        {"tagName": "v1.0", "name": "not data"},
        {"tagName": "data-2026-11-25", "name": "Data 2026-11-25", "publishedAt": "y"},
    ]
    files = snapshots.build(out, rel, "owner/repo")
    d = json.loads((out / snapshots.FILE).read_text())
    assert files[0]["rows"] == 2
    assert [s["date"] for s in d["snapshots"]] == ["2026-11-25", "2026-11-24"]
    assert d["snapshots"][0]["url"].endswith("/data-2026-11-25/data-2026-11-25.tar.zst")


def test_check_newest_must_match_as_of(tmp_path):
    out = _out(tmp_path, as_of="2026-11-26")
    with pytest.raises(snapshots.SnapshotCheckError):
        snapshots.build(out, [{"tagName": "data-2026-11-25"}], "owner/repo")
