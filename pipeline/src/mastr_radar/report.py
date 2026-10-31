"""Markdown run summary for the daily GitHub Action (shown in the run's summary page)."""

from __future__ import annotations

import json
from pathlib import Path

LABELS = {
    "wind_onshore": "Onshore wind",
    "wind_offshore": "Offshore wind",
    "solar": "Solar",
    "storage": "Storage",
    "biomass": "Biomass",
    "hydro": "Hydro",
}


def _gw(kw: float) -> str:
    return f"{kw / 1e6:,.2f} GW"


def markdown_summary(output_dir: Path, crosscheck_path: Path) -> str:
    manifest = json.loads((output_dir / "manifest.json").read_text())
    kpis = json.loads((output_dir / "kpis.json").read_text())
    lines = [
        f"## MaStR Radar: data as of {manifest['as_of']}",
        "",
        "| Technology | Installed | Units | Added this year | Planned |",
        "|---|---|---|---|---|",
    ]
    for k in kpis:
        lines.append(
            f"| {LABELS.get(k['technology'], k['technology'])} | {_gw(k['installed_capacity_kw'])} "
            f"| {k['installed_units']:,} | {_gw(k['added_capacity_kw_ytd'])} "
            f"| {_gw(k['planned_capacity_kw'])} |"
        )
    if crosscheck_path.exists():
        cc = json.loads(crosscheck_path.read_text())
        lines += ["", "### Cross-check with Energy-Charts", ""]
        if cc.get("rows"):
            lines += ["| Technology | Ours | Energy-Charts | Difference |", "|---|---|---|---|"]
            for r in cc["rows"]:
                mark = "✅" if r["ok"] else "⚠️"
                lines.append(
                    f"| {LABELS.get(r['technology'], r['technology'])} | {r['ours_gw']} GW "
                    f"| {r['energy_charts_gw']} GW | {mark} {r['diff_pct']:+}% |"
                )
        for w in cc.get("warnings", []):
            lines.append(f"- ⚠️ {w}")
    return "\n".join(lines) + "\n"
