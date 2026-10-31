"""Cross-check installed capacity against Fraunhofer ISE Energy-Charts.

Runs after station 3. It only warns and never fails the pipeline: Energy-Charts
is an outside source that can be late, down or define things slightly
differently.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime
from pathlib import Path

import requests

from mastr_radar.config import CrosscheckSettings

log = logging.getLogger(__name__)


def fetch(settings: CrosscheckSettings) -> dict:
    r = requests.get(settings.url, timeout=settings.timeout_seconds)
    r.raise_for_status()
    return r.json()


def compare(kpis: list[dict], ec: dict, as_of: date, settings: CrosscheckSettings) -> dict:
    """Compare our installed GW with Energy-Charts for the as-of month (or the latest)."""
    times = ec.get("time", [])
    month = f"{as_of:%m.%Y}"
    idx = times.index(month) if month in times else len(times) - 1
    series = {p["name"]: p["data"] for p in ec.get("production_types", [])}
    ours = {k["technology"]: k["installed_capacity_kw"] / 1e6 for k in kpis}

    rows, warnings = [], []
    if month not in times:
        warnings.append(f"Energy-Charts has no data for {month}; compared with {times[idx]}.")
    for tech, name in settings.series.items():
        if tech not in ours:
            continue  # technology not extracted yet
        data = series.get(name)
        theirs = data[idx] if data and idx >= 0 and data[idx] is not None else None
        if theirs is None:
            warnings.append(f"Energy-Charts has no value for {name!r}.")
            continue
        diff_pct = (ours[tech] - theirs) / theirs * 100 if theirs else float("inf")
        ok = abs(diff_pct) <= settings.tolerance_pct
        rows.append(
            {
                "technology": tech,
                "ours_gw": round(ours[tech], 3),
                "energy_charts_gw": round(theirs, 3),
                "diff_pct": round(diff_pct, 2),
                "ok": ok,
            }
        )
        if not ok:
            warnings.append(
                f"{tech}: ours {ours[tech]:.2f} GW vs Energy-Charts {theirs:.2f} GW "
                f"({diff_pct:+.1f}%, tolerance ±{settings.tolerance_pct}%)."
            )
    return {
        "as_of": as_of.isoformat(),
        "compared_month": times[idx] if times else None,
        "energy_charts_updated": (
            datetime.fromtimestamp(ec["last_update"], UTC).isoformat(timespec="seconds")
            if ec.get("last_update")
            else None
        ),
        "tolerance_pct": settings.tolerance_pct,
        "rows": rows,
        "warnings": warnings,
    }


def run(kpis_path: Path, as_of: date, settings: CrosscheckSettings, report_path: Path) -> dict:
    """Fetch, compare and write the report. Network problems become a warning."""
    kpis = json.loads(kpis_path.read_text())
    try:
        result = compare(kpis, fetch(settings), as_of, settings)
    except (requests.RequestException, ValueError, KeyError) as exc:
        result = {
            "as_of": as_of.isoformat(),
            "rows": [],
            "warnings": [f"Cross-check skipped: {exc}"],
        }
    result["checked_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(result, indent=2) + "\n")
    return result
