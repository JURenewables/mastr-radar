"""Daily snapshots (contract v1.10, WP78): index of the dated copies of the
explorer files kept as GitHub Release assets → snapshots.json.

The daily workflow packs web/public/data (without the day files) into
data-YYYY-MM-DD.tar.zst and attaches it to the release data-YYYY-MM-DD;
this module turns the list of releases into the published index.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

FILE = "snapshots.json"
TAG = re.compile(r"^data-(\d{4}-\d{2}-\d{2})$")


class SnapshotCheckError(Exception):
    """Raised when the snapshot index breaks the contract."""


def build(out_dir: Path, releases: list[dict], repo: str) -> list[dict]:
    snaps = []
    for r in releases:
        m = TAG.match(r.get("tagName", ""))
        if not m:
            continue
        date = m.group(1)
        snaps.append({
            "date": date,
            "tag": r["tagName"],
            "name": r.get("name") or r["tagName"],
            "published": r.get("publishedAt"),
            "url": f"https://github.com/{repo}/releases/download/{r['tagName']}/data-{date}.tar.zst",
        })  # fmt: skip
    snaps.sort(key=lambda s: s["date"], reverse=True)
    out = {
        "repo": repo,
        "format": "tar + zstd archive with the explorer files of that day (without days/)",
        "snapshots": snaps,
    }
    check_data(out, out_dir)
    path = out_dir / FILE
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return [{"name": FILE, "rows": len(snaps), "bytes": path.stat().st_size}]


def check_data(d: dict, out_dir: Path) -> None:
    problems = []
    snaps = d.get("snapshots", [])
    if not snaps:
        problems.append("no snapshots.")
    else:
        as_of = json.loads((out_dir / "manifest.json").read_text())["as_of"]
        if snaps[0]["date"] != as_of:
            problems.append(f"newest snapshot {snaps[0]['date']} is not the data date {as_of}.")
        if len({s["date"] for s in snaps}) != len(snaps):
            problems.append("duplicate snapshot dates.")
    if problems:
        raise SnapshotCheckError("Snapshot index check failed: " + " ".join(problems))
