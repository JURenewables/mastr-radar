"""Data dictionary (contract v1.10 draft, WP75): config/data_dictionary.yaml is
checked against every published file and written to data/dictionary.json."""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow.parquet as pq
import yaml

from mastr_radar.config import PIPELINE_ROOT

DICT_PATH = PIPELINE_ROOT / "config" / "data_dictionary.yaml"
FILE = "dictionary.json"


class DictionaryCheckError(Exception):
    """Raised when the dictionary and the published files disagree."""


def actual_fields(path: Path) -> list[str]:
    """Columns (Parquet), properties (GeoJSON) or top-level keys (JSON) of a file."""
    if path.suffix == ".parquet":
        return pq.read_schema(path).names
    data = json.loads(path.read_text())
    if path.suffix == ".geojson":
        return list(data["features"][0]["properties"]) if data.get("features") else []
    return ["[]"] if isinstance(data, list) else list(data)


def problems_for(d: dict, out_dir: Path, published: list[str]) -> list[str]:
    problems = []
    entries = {e["file"]: e for e in d["datasets"]}
    lic = set(d.get("licences", {}))
    for name in published:
        e = entries.get(name)
        if e is None:
            problems.append(f"{name}: published but not in the data dictionary.")
            continue
        have = set(actual_fields(out_dir / name))
        described = set(e.get("fields", {}))
        if missing := sorted(have - described):
            problems.append(f"{name}: undescribed {missing}.")
        if stale := sorted(described - have):
            problems.append(f"{name}: dictionary describes fields that no longer exist {stale}.")
    for name, e in entries.items():
        if e.get("licence") not in lic:
            problems.append(f"{name}: unknown licence {e.get('licence')!r}.")
        if not e.get("title") or not e.get("grain"):
            problems.append(f"{name}: needs title and grain.")
    return problems


def build(out_dir: Path, published: list[str] | None = None, path: Path = DICT_PATH) -> list[dict]:
    d = yaml.safe_load(path.read_text())
    if published is None:
        manifest = json.loads((out_dir / "manifest.json").read_text())
        published = [f["name"] for f in manifest["files"]]
    published = [n for n in published if n != FILE]
    if problems := problems_for(d, out_dir, published):
        raise DictionaryCheckError("Data dictionary check failed:\n- " + "\n- ".join(problems))
    for e in d["datasets"]:
        e["fields"] = {
            k: (v if isinstance(v, dict) else {"desc": v}) for k, v in e.get("fields", {}).items()
        }
    (out_dir / FILE).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
    return [{"name": FILE, "rows": len(d["datasets"]), "bytes": (out_dir / FILE).stat().st_size}]


def check(out_dir: Path) -> None:
    d = json.loads((out_dir / FILE).read_text())
    published = [
        f["name"]
        for f in json.loads((out_dir / "manifest.json").read_text())["files"]
        if f["name"] != FILE
    ]
    if problems := problems_for(d, out_dir, published):
        raise DictionaryCheckError("Data dictionary check failed:\n- " + "\n- ".join(problems))
