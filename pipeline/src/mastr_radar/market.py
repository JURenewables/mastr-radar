"""Market values from SMARD (contract v1.12, WP95): what solar and onshore wind
earned on the day-ahead market per MWh ("capture price"), by month and over
the last 12 complete months.

Station 1 (fetch, cached in data/market/) and the input to the full-life case
of the profitability model. Source: Bundesnetzagentur | SMARD.de, CC BY 4.0.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

BASE = "https://www.smard.de/app/chart_data"
SERIES = {"price": 4169, "solar": 4068, "wind_onshore": 4067}
FILE = "market_values.json"
BERLIN = ZoneInfo("Europe/Berlin")


class MarketCheckError(Exception):
    """Raised when the market values look wrong."""


def _get(url: str, attempts: int = 4) -> dict:
    for i in range(attempts):
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError):
            if i == attempts - 1:
                raise
    raise RuntimeError("unreachable")


def fetch_hourly(weeks: int = 58) -> dict[str, dict[int, float]]:
    """Hourly values of the last `weeks` weeks per series: {name: {ts_ms: value}}."""
    out: dict[str, dict[int, float]] = {}
    for name, fid in SERIES.items():
        index = _get(f"{BASE}/{fid}/DE/index_hour.json")["timestamps"][-weeks:]
        vals: dict[int, float] = {}
        for ts in index:
            for t, v in _get(f"{BASE}/{fid}/DE/{fid}_DE_hour_{ts}.json")["series"]:
                if v is not None:
                    vals[int(t)] = float(v)
        out[name] = vals
    return out


def capture_prices(hourly: dict[str, dict[int, float]]) -> dict:
    """Monthly and 12-month capture prices (€/MWh) and the baseload average."""
    price = hourly["price"]
    acc: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
    for t, p in price.items():
        month = datetime.fromtimestamp(t / 1000, UTC).astimezone(BERLIN).strftime("%Y-%m")
        base = acc[month]["baseload"]
        base[0] += p
        base[1] += 1
        for tech in ("solar", "wind_onshore"):
            g = hourly[tech].get(t)
            if g:
                a = acc[month][tech]
                a[0] += g * p
                a[1] += g
    months = sorted(acc)
    now = datetime.now(UTC).astimezone(BERLIN).strftime("%Y-%m")
    complete = [m for m in months if m < now and acc[m]["baseload"][1] >= 24 * 27][-12:]
    monthly = [
        {
            "month": m,
            **{
                k: round(acc[m][k][0] / acc[m][k][1], 2)
                for k in ("baseload", "solar", "wind_onshore")
                if acc[m][k][1]
            },
        }
        for m in complete
    ]

    def total(k: str) -> float:
        s = sum(acc[m][k][0] for m in complete)
        n = sum(acc[m][k][1] for m in complete)
        return round(s / n, 2)

    return {
        "source": "Bundesnetzagentur | SMARD.de (CC BY 4.0), day-ahead price DE-LU and generation",
        "unit": "€/MWh",
        "period": [complete[0], complete[-1]] if complete else None,
        "last_12m": {k: total(k) for k in ("baseload", "solar", "wind_onshore")}
        if complete
        else None,
        "monthly": monthly,
    }


def check(d: dict) -> None:
    problems = []
    if not d.get("last_12m") or len(d.get("monthly", [])) < 12:
        problems.append("need 12 complete months.")
    else:
        for k, v in d["last_12m"].items():
            if not -50 < v < 500:
                problems.append(f"{k}: implausible {v} €/MWh.")
    if problems:
        raise MarketCheckError("Market values check failed: " + " ".join(problems))


def fetch(cache_dir: Path) -> Path:
    d = capture_prices(fetch_hourly())
    d["fetched"] = datetime.now(UTC).date().isoformat()
    check(d)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / FILE
    path.write_text(json.dumps(d, indent=1))
    return path
