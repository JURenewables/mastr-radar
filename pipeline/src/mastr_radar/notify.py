"""Phone report: a short daily summary sent through a Telegram bot.

Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment (GitHub
Secrets). Without them nothing is sent. Secrets are never printed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import requests

SITE = "https://mastr-radar.vercel.app"
LABELS = {
    "solar": "Solar",
    "wind_onshore": "Wind onshore",
    "wind_offshore": "Wind offshore",
    "storage": "Storage",
    "biomass": "Biomass",
    "hydro": "Hydro",
}


def _gw(kw: float) -> str:
    return f"{kw / 1e6:,.1f} GW"


def _delta(kw: float) -> str:
    mw = kw / 1000
    if abs(mw) < 0.5:
        return "±0 MW"
    return f"{'+' if mw > 0 else '−'}{abs(mw):,.0f} MW"


def daily_text(out_dir: Path, previous_kpis: list[dict] | None) -> str:
    manifest = json.loads((out_dir / "manifest.json").read_text())
    kpis = json.loads((out_dir / "kpis.json").read_text())
    prev = {k["technology"]: k for k in previous_kpis or []}
    order = list(LABELS)
    rank = lambda k: order.index(k["technology"]) if k["technology"] in order else 99  # noqa: E731
    lines = [f"⚡ MaStR Radar · data as of {manifest['as_of']}", ""]
    for k in sorted(kpis, key=rank):
        t, kw = k["technology"], k["installed_capacity_kw"]
        p = prev.get(t)
        change = f" ({_delta(kw - p['installed_capacity_kw'])} since last update)" if p else ""
        lines.append(f"{LABELS.get(t, t)}: {_gw(kw)}{change}")
    added = sum(k["added_capacity_kw_ytd"] for k in kpis)
    lines += ["", f"Added this year: {_gw(added)}"]
    risk = out_dir / "auctions" / "market_risk.json"
    if risk.exists():
        last = json.loads(risk.read_text()).get("wind", {}).get("price_last")
        if last:
            lines.append(f"Latest onshore award: {last['avg_ct']} ct ({last['bid_date'][:7]})")
    lines += ["", SITE]
    return "\n".join(lines)


def send(text: str) -> str:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat:
        return (
            "Telegram not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing): nothing sent."
        )
    r = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat, "text": text, "disable_web_page_preview": True},
        timeout=30,
    )
    return "Telegram: sent." if r.ok else f"Telegram: failed ({r.status_code})."
