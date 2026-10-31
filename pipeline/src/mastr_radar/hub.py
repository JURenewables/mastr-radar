"""Data hub (contract v1.4): H1 fetch SMARD, H2 build day files.

SMARD publishes quarter-hourly series in weekly files (Monday 00:00 German
time). Values are energy per quarter hour (MWh); average power is MWh × 4.
Licence CC BY 4.0, attribution "Bundesnetzagentur | SMARD.de".
"""

from __future__ import annotations

import io
import json
import logging
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import requests

from mastr_radar.config import HubSettings

log = logging.getLogger(__name__)

BERLIN = ZoneInfo("Europe/Berlin")
QUARTER_MS = 15 * 60 * 1000
ATTRIBUTION = ["Bundesnetzagentur | SMARD.de", "Deutscher Wetterdienst"]
MAX_DAYS_BYTES = 30 * 1024 * 1024
HOUR_MS = 3600 * 1000
CONTRACT_VERSION = "1.5"


class HubCheckError(RuntimeError):
    """The day files do not meet contract v1.4."""


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


# --- H1 Fetch: DWD weather stations ------------------------------------------


def fetch_dwd(settings: HubSettings, cache_dir: Path, workers: int = 8) -> int:
    """Download DWD station lists and the 'recent' files (about the last 500 days).

    The recent files are updated daily, so they are always downloaded again.
    """
    cfg = settings.dwd
    cache_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for kind in ("solar", "wind"):
        folder = f"{cfg['base_url']}/{cfg[kind + '_dir']}"
        (cache_dir / kind).mkdir(exist_ok=True)
        jobs.append((f"{folder}/{cfg[kind + '_stations']}", cache_dir / kind / "stations.txt"))
        listing = requests.get(f"{folder}/", timeout=60)
        listing.raise_for_status()
        for name in sorted(set(re.findall(r'href="([^"]+_akt\.zip)"', listing.text))):
            jobs.append((f"{folder}/{name}", cache_dir / kind / name))

    def download(job):
        url, path = job
        for attempt in range(4):
            try:
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                path.write_bytes(r.content)
                return
            except requests.RequestException:
                if attempt == 3:
                    raise

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(download, jobs))
    log.info("DWD: %d files downloaded", len(jobs))
    return len(jobs)


def read_stations(path: Path) -> dict[str, tuple[float, float, str]]:
    """Station id → (lat, lon, name) from a DWD station description file."""
    out = {}
    for line in path.read_text(encoding="latin-1").splitlines()[2:]:
        parts = line.split()
        if len(parts) < 7 or not parts[0].isdigit():
            continue
        name = " ".join(parts[6:-2]) if len(parts) > 8 else parts[6]
        out[str(int(parts[0]))] = (float(parts[4]), float(parts[5]), name)
    return out


def read_dwd_series(cache_dir: Path, kind: str, start_ms: int, hours: int) -> dict[str, np.ndarray]:
    """Station id → hourly array (UTC hours from start_ms), NaN where missing.

    Solar: mean global radiation in W/m² from GS_10 (J/cm² per 10 min ×
    10 000 / 600 s); an hour needs at least 4 of its 6 values. Wind: hourly
    mean speed F in m/s.
    """
    out: dict[str, np.ndarray] = {}
    for zpath in sorted((cache_dir / kind).glob("*_akt.zip")):
        with zipfile.ZipFile(zpath) as zf:
            member = next((n for n in zf.namelist() if n.startswith("produkt")), None)
            if member is None:
                continue
            text = io.TextIOWrapper(zf.open(member), encoding="latin-1")
            sums = np.zeros(hours)
            counts = np.zeros(hours)
            station = None
            for line in text:
                parts = line.split(";")
                if not parts[0].strip().isdigit():
                    continue
                station = str(int(parts[0]))
                stamp = parts[1].strip()
                t = datetime(
                    int(stamp[0:4]), int(stamp[4:6]), int(stamp[6:8]), int(stamp[8:10]), tzinfo=UTC
                )
                i = int((t.timestamp() * 1000 - start_ms) // HOUR_MS)
                if not 0 <= i < hours:
                    continue
                raw = float(parts[4] if kind == "solar" else parts[3])
                if raw < 0:  # -999: missing
                    continue
                sums[i] += raw * 10_000 / 600 if kind == "solar" else raw
                counts[i] += 1
            if station is None:
                continue
            need = 4 if kind == "solar" else 1
            with np.errstate(invalid="ignore", divide="ignore"):
                series = np.where(counts >= need, sums / np.maximum(counts, 1), np.nan)
            out[station] = series
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


def day_hours(day: date) -> list[int]:
    """UTC ms of every hour of a local (Europe/Berlin) day: 23, 24 or 25 hours."""
    return day_slots(day)[::4]


def weather_block(day: date, weather: dict | None) -> dict | None:
    """Hourly radiation (W/m², integer) and wind (0.1 m/s, integer) per station.

    Stations with less than 80 % of the day's hours are left out that day.
    """
    if not weather:
        return None
    hours = day_hours(day)
    idx = [int((t - weather["start_ms"]) // HOUR_MS) for t in hours]
    block: dict = {"hours": len(hours)}
    for kind, key, factor in (("solar", "radiation_wm2", 1), ("wind", "wind_dms", 10)):
        ids, values = [], []
        for sid, series in weather[kind].items():
            if idx[0] < 0 or idx[-1] >= len(series):
                continue
            row = series[idx]
            if np.isnan(row).sum() > 0.2 * len(row):
                continue
            ids.append(sid)
            values.append([None if np.isnan(v) else round(float(v) * factor) for v in row])
        block[f"{kind}_stations"] = ids
        block[key] = values
    return block


def build_day(day: date, cache: dict, settings: HubSettings, weather: dict | None = None) -> dict:
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
        "weather": weather_block(day, weather),
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


def load_weather(dwd_dir: Path, first: date, today: date, days_dir: Path) -> dict | None:
    """Hourly DWD series for the window, and days/stations.json with coordinates."""
    if not (dwd_dir / "solar" / "stations.txt").exists():
        log.warning("No DWD cache: day files without weather.")
        return None
    start = datetime.combine(first - timedelta(days=1), datetime.min.time(), UTC)
    start_ms = int(start.timestamp() * 1000)
    hours = (today - first).days * 24 + 72
    weather = {"start_ms": start_ms}
    stations = {}
    for kind in ("solar", "wind"):
        weather[kind] = read_dwd_series(dwd_dir, kind, start_ms, hours)
        coords = read_stations(dwd_dir / kind / "stations.txt")
        stations[kind] = [
            [sid, round(coords[sid][0], 4), round(coords[sid][1], 4), coords[sid][2]]
            for sid in sorted(weather[kind], key=int)
            if sid in coords
        ]
        weather[kind] = {sid: v for sid, v in weather[kind].items() if sid in coords}
    (days_dir / "stations.json").write_text(
        json.dumps({**stations, "sources": ["Deutscher Wetterdienst"]}, ensure_ascii=False)
    )
    return weather


def build_days(settings: HubSettings, cache_dir: Path, out_dir: Path, today: date) -> dict:
    """Write day files for the last keep_days complete days and the index."""
    days_dir = out_dir / "days"
    days_dir.mkdir(parents=True, exist_ok=True)
    cache = load_cache(settings, cache_dir)
    first = today - timedelta(days=settings.keep_days)
    weather = load_weather(cache_dir.parent / "dwd", first, today, days_dir)
    written, skipped = [], []
    d = first
    while d < today:  # today is never written: it is not complete yet
        day = build_day(d, cache, settings, weather)
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
    """Contract v1.4 check for day files. Raises HubCheckError."""
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
        w = day.get("weather")
        if w:
            if w["hours"] != expected // 4:
                problems.append(f"{d}: weather has {w['hours']} hours, expected {expected // 4}.")
            if len(w["solar_stations"]) < 50 or len(w["wind_stations"]) < 100:
                problems.append(f"{d}: too few weather stations.")
            rad = [v for row in w["radiation_wm2"] for v in row if v is not None]
            wind = [v for row in w["wind_dms"] for v in row if v is not None]
            if rad and (min(rad) < 0 or max(rad) > 1500):
                problems.append(f"{d}: radiation outside 0–1500 W/m².")
            if wind and (min(wind) < 0 or max(wind) > 600):
                problems.append(f"{d}: wind outside 0–60 m/s.")
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
