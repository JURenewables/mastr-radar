"""Data hub (contract v1.4 draft): H1 fetch SMARD, H2 build day files.

SMARD publishes quarter-hourly series in weekly files (Monday 00:00 German
time). Values are energy per quarter hour (MWh); average power is MWh × 4.
Licence CC BY 4.0, attribution "Bundesnetzagentur | SMARD.de".
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

from mastr_radar.config import HubSettings

log = logging.getLogger(__name__)

BERLIN = ZoneInfo("Europe/Berlin")
QUARTER_MS = 15 * 60 * 1000
ATTRIBUTION = ["Bundesnetzagentur | SMARD.de"]
MAX_DAYS_BYTES = 20 * 1024 * 1024
CONTRACT_VERSION = "1.4"


class HubCheckError(RuntimeError):
    """The day files do not meet contract v1.4 (draft)."""


def _series(settings: HubSettings) -> dict[str, int]:
    """Our series name → SMARD filter id."""
    return {
        **{f"gen:{k}": v for k, v in settings.smard_generation.items()},
        "demand": settings.smard_demand,
        "residual_load": settings.smard_residual_load,
    }


# --- H1 Fetch -----------------------------------------------------------------


def _get_json(url: str, timeout: float = 30, attempts: int = 4) -> dict:
    for i in range(attempts):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError):
            if i == attempts - 1:
                raise
    raise RuntimeError("unreachable")


def fetch_smard(settings: HubSettings, cache_dir: Path, today: date, workers: int = 8) -> int:
    """Download the weekly files covering the last keep_days (+ a margin).

    Files already cached are kept, except the two newest weeks, which SMARD
    may still update. Returns the number of files downloaded.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    start = datetime.combine(
        today - timedelta(days=settings.keep_days + 8), datetime.min.time(), BERLIN
    )
    start_ms = int(start.timestamp() * 1000)
    jobs = []
    for _name, fid in _series(settings).items():
        for region in settings.smard_regions:
            try:
                index = _get_json(
                    f"{settings.smard_base_url}/{fid}/{region}/index_quarterhour.json"
                )
            except requests.HTTPError as exc:
                # Some series do not exist for a grid area (e.g. offshore wind in
                # Amprion or TransnetBW): they are zero there, not missing.
                status = exc.response.status_code if exc.response is not None else None
                if status == 404 and region != "DE":
                    (cache_dir / f"{fid}_{region}_absent").touch()
                    log.info("SMARD: no series %s for %s (treated as zero)", fid, region)
                    continue
                raise
            stamps = sorted(index["timestamps"])
            wanted = [t for t in stamps if t >= start_ms - 7 * 86_400_000]
            for t in wanted:
                path = cache_dir / f"{fid}_{region}_{t}.json"
                if path.exists() and t not in stamps[-2:]:
                    continue
                url = (
                    f"{settings.smard_base_url}/{fid}/{region}/{fid}_{region}_quarterhour_{t}.json"
                )
                jobs.append((url, path))

    def download(job):
        url, path = job
        data = _get_json(url)
        path.write_text(json.dumps(data["series"], separators=(",", ":")))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(download, jobs))
    log.info("SMARD: %d files downloaded", len(jobs))
    return len(jobs)


class _Zero(dict):
    """A series that does not exist for a region: zero at every quarter hour."""

    def get(self, key, default=None):
        return 0.0


def load_cache(
    settings: HubSettings, cache_dir: Path
) -> dict[tuple[str, str], dict[int, float | None]]:
    """(series name, region) → {utc ms: MWh per quarter hour}."""
    out: dict[tuple[str, str], dict[int, float | None]] = {}
    for name, fid in _series(settings).items():
        for region in settings.smard_regions:
            if (cache_dir / f"{fid}_{region}_absent").exists():
                out[(name, region)] = _Zero()
                continue
            values: dict[int, float | None] = {}
            for path in sorted(cache_dir.glob(f"{fid}_{region}_*.json")):
                for ts, v in json.loads(path.read_text()):
                    values[int(ts)] = v
            out[(name, region)] = values
    return out


# --- H2 Build day files -------------------------------------------------------


def day_slots(day: date) -> list[int]:
    """UTC ms of every quarter hour of a local (Europe/Berlin) day."""
    start = datetime.combine(day, datetime.min.time(), BERLIN)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), BERLIN)
    s, e = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    return list(range(s, e, QUARTER_MS))


def _mw(v: float | None) -> int | None:
    return None if v is None else round(v * 4)


def _clean_night_solar(series: list[int | None], slots: list[int]) -> int:
    """Empty solar values at night (22:00-04:00 local) above 2 % of the day's
    peak: single source errors (e.g. a 360 MW spike at midnight). Returns count."""
    peak = max((v or 0) for v in series)
    cleaned = 0
    for i, t in enumerate(slots):
        hour = datetime.fromtimestamp(t / 1000, BERLIN).hour
        v = series[i]
        if (hour >= 22 or hour < 4) and v is not None and peak > 0 and v > 0.02 * peak:
            series[i] = None
            cleaned += 1
    return cleaned


def build_day(day: date, cache: dict, settings: HubSettings) -> dict:
    slots = day_slots(day)
    gen, demand, residual = {}, {}, {}
    cleaned = 0
    for region in settings.smard_regions:
        gen[region] = {
            tech: [_mw(cache[(f"gen:{tech}", region)].get(t)) for t in slots]
            for tech in settings.smard_generation
        }
        cleaned += _clean_night_solar(gen[region]["solar"], slots)
        demand[region] = [_mw(cache[("demand", region)].get(t)) for t in slots]
        residual[region] = [_mw(cache[("residual_load", region)].get(t)) for t in slots]
    return {
        "date": day.isoformat(),
        "slots": len(slots),
        "start_utc": datetime.fromtimestamp(slots[0] / 1000, UTC).isoformat(),
        "regions": list(settings.smard_regions),
        "generation_mw": gen,
        "demand_mw": demand,
        "residual_load_mw": residual,
        "cleaned_values": cleaned,
        "sources": ATTRIBUTION,
    }


def _complete(series: list[int | None]) -> bool:
    return sum(v is None for v in series) <= 0.1 * len(series)


def _day_complete(day: dict) -> bool:
    """Every series of every region at least 90 % filled (recent days fill up later)."""
    for region in day["regions"]:
        series = [day["demand_mw"][region], day["residual_load_mw"][region]]
        series += list(day["generation_mw"][region].values())
        if not all(_complete(s) for s in series):
            return False
    return True


def build_days(settings: HubSettings, cache_dir: Path, out_dir: Path, today: date) -> dict:
    """Write day files for the last keep_days complete days and the index."""
    days_dir = out_dir / "days"
    days_dir.mkdir(parents=True, exist_ok=True)
    cache = load_cache(settings, cache_dir)
    first = today - timedelta(days=settings.keep_days)
    written, skipped = [], []
    d = first
    while d < today:  # today is never written: it is not complete yet
        day = build_day(d, cache, settings)
        if _day_complete(day):
            path = days_dir / f"{d.isoformat()}.json"
            path.write_text(json.dumps(day, separators=(",", ":")))
            written.append(d.isoformat())
        else:
            skipped.append(d.isoformat())
        d += timedelta(days=1)
    # Remove files outside the window.
    for path in days_dir.glob("????-??-??.json"):
        if path.stem < first.isoformat():
            path.unlink()
    dates = sorted(p.stem for p in days_dir.glob("????-??-??.json"))
    index = {
        "contract_version": CONTRACT_VERSION,
        "first": dates[0] if dates else None,
        "last": dates[-1] if dates else None,
        "dates": dates,
        "bytes": {dd: (days_dir / f"{dd}.json").stat().st_size for dd in dates},
        "sources": ATTRIBUTION,
    }
    (days_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    if skipped:
        log.warning("Skipped incomplete days: %s", ", ".join(skipped[-5:]))
    return {
        "written": len(written),
        "skipped": skipped,
        "first": index["first"],
        "last": index["last"],
    }


# --- Check ------------------------------------------------------------------


def check_days(out_dir: Path, settings: HubSettings) -> None:
    """Contract v1.4 (draft) check for day files. Raises HubCheckError."""
    problems: list[str] = []
    days_dir = out_dir / "days"
    index = json.loads((days_dir / "index.json").read_text())
    total = 0
    for d in index["dates"]:
        path = days_dir / f"{d}.json"
        if not path.exists():
            problems.append(f"{d}: listed in index but missing.")
            continue
        total += path.stat().st_size
        day = json.loads(path.read_text())
        expected = len(day_slots(date.fromisoformat(d)))
        if day["slots"] != expected:
            problems.append(f"{d}: {day['slots']} slots, expected {expected}.")
        for region in settings.smard_regions:
            series = [day["demand_mw"][region]] + list(day["generation_mw"][region].values())
            if any(len(s) != expected or not _complete(s) for s in series):
                problems.append(f"{d}: incomplete series in {region}.")
                break
        solar = [v or 0 for v in day["generation_mw"]["DE"]["solar"]]
        peak = max(solar) or 1
        night = solar[: 3 * 4] + solar[-4:]  # 00:00-03:00 and 23:00-24:00
        if max(night) > 0.02 * peak and peak > 100:  # same threshold as the cleaning rule
            problems.append(f"{d}: solar output at night.")
        tsos = [r for r in settings.smard_regions if r != "DE"]
        sums = {
            r: {
                "solar": sum(v or 0 for v in day["generation_mw"][r]["solar"]),
                "wind_onshore": sum(v or 0 for v in day["generation_mw"][r]["wind_onshore"]),
                "demand": sum(v or 0 for v in day["demand_mw"][r]),
            }
            for r in settings.smard_regions
        }
        for key in ("solar", "wind_onshore", "demand"):
            de = sums["DE"][key]
            parts = sum(sums[r][key] for r in tsos)
            # 5 % of the national value plus 1 % of the day's demand: tiny winter
            # solar totals may differ more in relative terms without mattering.
            if abs(parts - de) > 0.05 * de + 0.01 * sums["DE"]["demand"]:
                problems.append(
                    f"{d}: grid areas do not add up to DE for {key} ({parts / de:.1%})."
                )
        if len(problems) > 20:
            break
    if total > MAX_DAYS_BYTES:
        problems.append(f"days/ is {total:,} bytes, over 20 MB.")
    if problems:
        raise HubCheckError("; ".join(problems[:20]))
