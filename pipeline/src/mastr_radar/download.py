"""Station 1: download the BNetzA bulk export and check it (contract v1.1).

The BNetzA server is slow and drops connections, so the download writes to a
`.part` file and resumes with HTTP range requests after every break.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import re
import time
import zipfile
import zlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

import requests

from mastr_radar.config import DownloadSettings

log = logging.getLogger(__name__)

EXPORT_URL_RE = re.compile(r"https://[^\s\"'<>]*/Gesamtdatenexport_(\d{8})_[\d.]+\.zip")
EXPORT_NAME_RE = re.compile(r"Gesamtdatenexport_(\d{8})")
CHUNK = 1 << 16  # 64 KiB: little is lost when a connection drops mid-chunk
MAX_WAIT_SECONDS = 300


class DownloadError(RuntimeError):
    """The download failed after all attempts."""


class ExportCheckError(RuntimeError):
    """The downloaded export does not pass the station 1 check."""


@dataclass
class DownloadResult:
    path: Path
    size_bytes: int
    attempts: int
    duration_seconds: float


# --- Finding the export ------------------------------------------------------


def find_export_url(html: str) -> tuple[str, date]:
    """Return the newest export URL on the download page and its date."""
    found = {m.group(0): m.group(1) for m in EXPORT_URL_RE.finditer(html)}
    if not found:
        raise DownloadError("No Gesamtdatenexport link found on the download page.")
    url, day = max(found.items(), key=lambda kv: kv[1])
    return url, datetime.strptime(day, "%Y%m%d").date()


def fetch_export_url(page_url: str, timeout: float) -> tuple[str, date]:
    r = requests.get(page_url, timeout=timeout)
    r.raise_for_status()
    return find_export_url(r.text)


def export_date_from_name(path: Path) -> date:
    m = EXPORT_NAME_RE.search(path.name)
    if not m:
        raise ExportCheckError(f"Cannot read the export date from file name {path.name!r}.")
    return datetime.strptime(m.group(1), "%Y%m%d").date()


# --- Downloading -------------------------------------------------------------


def _total_from_content_range(value: str | None) -> int | None:
    # "bytes 1000-1999/3263586974"
    if value and "/" in value:
        tail = value.rsplit("/", 1)[1]
        if tail.isdigit():
            return int(tail)
    return None


def download_file(
    url: str,
    dest: Path,
    *,
    max_attempts: int,
    backoff_seconds: float,
    timeout_seconds: float,
    sleep: Callable[[float], None] = time.sleep,
) -> DownloadResult:
    """Download `url` to `dest`, resuming after broken connections."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    etag: str | None = None
    total: int | None = None
    started = time.monotonic()
    attempts = 0

    while True:
        attempts += 1
        have = part.stat().st_size if part.exists() else 0
        headers = {}
        if have:
            headers["Range"] = f"bytes={have}-"
            if etag:
                # If the file changed on the server, it sends the whole new file.
                headers["If-Range"] = etag
        try:
            with requests.get(url, headers=headers, stream=True, timeout=timeout_seconds) as r:
                if r.status_code == 416 and total is not None and have == total:
                    break  # already complete
                r.raise_for_status()
                if r.status_code == 206:
                    mode = "ab"
                    total = _total_from_content_range(r.headers.get("Content-Range")) or total
                else:
                    if have:
                        log.warning("Server sent the whole file again; restarting from zero.")
                    mode, have = "wb", 0
                    length = r.headers.get("Content-Length")
                    total = int(length) if length and length.isdigit() else None
                etag = r.headers.get("ETag", etag)
                with part.open(mode) as f:
                    for chunk in r.iter_content(CHUNK):
                        f.write(chunk)
            size = part.stat().st_size
            if total is None or size == total:
                break
            raise OSError(f"Connection ended early: {size:,} of {total:,} bytes.")
        except (requests.RequestException, OSError) as exc:
            if attempts >= max_attempts:
                raise DownloadError(f"Download failed after {attempts} attempts: {exc}") from exc
            wait = min(backoff_seconds * 2 ** (attempts - 1), MAX_WAIT_SECONDS)
            got = part.stat().st_size if part.exists() else 0
            log.warning(
                "Attempt %d failed (%s). Have %s bytes. Retrying in %.0f s.",
                attempts,
                exc,
                f"{got:,}",
                wait,
            )
            sleep(wait)

    part.replace(dest)
    return DownloadResult(
        path=dest,
        size_bytes=dest.stat().st_size,
        attempts=attempts,
        duration_seconds=round(time.monotonic() - started, 1),
    )


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


# --- Checking ----------------------------------------------------------------


def check_export(
    path: Path,
    settings: DownloadSettings,
    *,
    today: date | None = None,
    verify_crc: bool = True,
) -> dict:
    """Run the station 1 check. Raises ExportCheckError listing every problem."""
    today = today or date.today()
    problems: list[str] = []

    size = path.stat().st_size
    if size < settings.min_size_bytes:
        problems.append(f"File is {size:,} bytes, expected at least {settings.min_size_bytes:,}.")

    export_date = export_date_from_name(path)
    age = (today - export_date).days
    if age > settings.max_age_days:
        problems.append(f"Export is {age} days old (max {settings.max_age_days}).")

    if not zipfile.is_zipfile(path):
        raise ExportCheckError("; ".join([*problems, "File is not a readable zip."]))

    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        used: set[str] = set()
        for pattern in settings.required_files:
            matches = fnmatch.filter(names, pattern)
            if not matches:
                problems.append(f"No file matching {pattern!r} in the export.")
            used.update(matches)
        if verify_crc:
            for name in sorted(used):
                try:
                    with zf.open(name) as f:
                        while f.read(CHUNK):
                            pass  # reading to the end verifies the CRC
                except (zipfile.BadZipFile, zlib.error, OSError) as exc:
                    problems.append(f"Integrity check failed for {name}: {exc}")

    if problems:
        raise ExportCheckError("; ".join(problems))
    return {
        "export_date": export_date.isoformat(),
        "size_bytes": size,
        "files_in_zip": len(names),
        "files_checked": len(used),
        "crc_verified": verify_crc,
    }


# --- Metadata ----------------------------------------------------------------


def write_meta(
    meta_path: Path,
    zip_path: Path,
    *,
    source_url: str | None,
    check: dict,
    result: DownloadResult | None = None,
) -> dict:
    """Write download_meta.json next to the export. `result` is None if the zip already existed."""
    meta = {
        **check,
        "source_url": source_url,
        "sha256": sha256_of(zip_path),
        "written_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "attempts": result.attempts if result else 0,
        "duration_seconds": result.duration_seconds if result else 0.0,
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    return meta
