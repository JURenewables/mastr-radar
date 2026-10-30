"""Station 1 tests: a tiny local server stands in for the BNetzA download server."""

import os
import threading
import zipfile
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from mastr_radar import download as dl
from mastr_radar.config import DownloadSettings, load_settings

REQUIRED = load_settings().download.required_files


def make_settings(**overrides) -> DownloadSettings:
    base = dict(
        page_url="http://unused",
        max_attempts=5,
        backoff_seconds=0,
        timeout_seconds=5,
        max_age_days=3,
        min_size_bytes=100,
        required_files=REQUIRED,
    )
    base.update(overrides)
    return DownloadSettings(**base)


def make_export(path: Path, members: list[str] | None = None) -> Path:
    """Write a tiny fake export zip with one file per required pattern."""
    members = members or [
        "EinheitenWind.xml",
        "EinheitenSolar_1.xml",
        "EinheitenStromSpeicher_1.xml",
        "AnlagenStromSpeicher_1.xml",
        "EinheitenBiomasse.xml",
        "EinheitenWasser.xml",
        "Marktakteure_1.xml",
        "Katalogwerte.xml",
    ]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in members:
            zf.writestr(name, f"<root>{name}</root>" * 500)
        # Incompressible padding so the file spans several download chunks.
        zf.writestr("padding.bin", os.urandom(600_000), compress_type=zipfile.ZIP_STORED)
    return path


class FlakyServer:
    """Serves one file with range support. The first `drops` responses stop halfway."""

    def __init__(self, payload: bytes, drops: int = 0, etag: str = '"v1"', swap_to=None):
        self.payload, self.drops, self.etag = payload, drops, etag
        self.swap_to = swap_to  # (payload, etag) the server switches to after the first drop
        self.requests: list[str | None] = []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                rng = self.headers.get("Range")
                server.requests.append(rng)
                data, start = server.payload, 0
                if rng and self.headers.get("If-Range", server.etag) == server.etag:
                    start = int(rng.split("=")[1].split("-")[0])
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
                else:
                    self.send_response(200)
                body = data[start:]
                self.send_header("Content-Length", str(len(body)))
                self.send_header("ETag", server.etag)
                self.end_headers()
                if server.drops > 0:
                    server.drops -= 1
                    self.wfile.write(body[: len(body) // 2])
                    self.close_connection = True
                    if server.swap_to:
                        server.payload, server.etag = server.swap_to
                    return
                self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/Gesamtdatenexport_20261030_26.2.zip"

    def __enter__(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()


def _download(url, dest, **kw):
    params = dict(max_attempts=5, backoff_seconds=0, timeout_seconds=5, sleep=lambda s: None)
    params.update(kw)
    return dl.download_file(url, dest, **params)


# --- Finding the export ---


def test_find_export_url_picks_newest():
    html = (
        '<a href="https://download.marktstammdatenregister.de/Gesamtdatenexport_20261029_26.2.zip">'
        '<a href="https://download.marktstammdatenregister.de/Gesamtdatenexport_20261030_26.2.zip">'
    )
    url, day = dl.find_export_url(html)
    assert url.endswith("Gesamtdatenexport_20261030_26.2.zip")
    assert day == date(2026, 10, 30)


def test_find_export_url_fails_clearly_without_link():
    with pytest.raises(dl.DownloadError, match="No Gesamtdatenexport link"):
        dl.find_export_url("<html>nothing here</html>")


# --- Downloading ---


def test_download_in_one_go(tmp_path):
    payload = make_export(tmp_path / "src.zip").read_bytes()
    with FlakyServer(payload) as srv:
        res = _download(srv.url, tmp_path / "out" / "export.zip")
    assert res.path.read_bytes() == payload
    assert res.attempts == 1
    assert not (tmp_path / "out" / "export.zip.part").exists()


def test_download_resumes_after_broken_connections(tmp_path):
    payload = make_export(tmp_path / "src.zip").read_bytes()
    with FlakyServer(payload, drops=2) as srv:
        res = _download(srv.url, tmp_path / "export.zip")
        assert srv.requests[0] is None  # first request: whole file
        assert all(r and r.startswith("bytes=") for r in srv.requests[1:])  # then resumes
    assert res.path.read_bytes() == payload
    assert res.attempts == 3


def test_download_restarts_if_file_changed_on_server(tmp_path):
    old = make_export(tmp_path / "old.zip").read_bytes()
    new = make_export(tmp_path / "new.zip", members=["EinheitenWind.xml", "Katalogwerte.xml"])
    new_bytes = new.read_bytes()
    with FlakyServer(old, drops=1, swap_to=(new_bytes, '"v2"')) as srv:
        res = _download(srv.url, tmp_path / "export.zip")
    # The half-downloaded old file must not be glued to the new one.
    assert res.path.read_bytes() == new_bytes


def test_download_gives_up_after_max_attempts(tmp_path):
    payload = make_export(tmp_path / "src.zip").read_bytes()
    with FlakyServer(payload, drops=99) as srv, pytest.raises(dl.DownloadError, match="3 attempts"):
        _download(srv.url, tmp_path / "export.zip", max_attempts=3)


# --- Checking ---


def test_check_passes_on_good_export(tmp_path):
    zp = make_export(tmp_path / "Gesamtdatenexport_20261030.zip")
    info = dl.check_export(zp, make_settings(), today=date(2026, 10, 31))
    assert info["export_date"] == "2026-10-30"
    assert info["files_checked"] == 8
    assert info["crc_verified"] is True


def test_check_lists_every_problem(tmp_path):
    zp = make_export(tmp_path / "Gesamtdatenexport_20261001.zip", members=["EinheitenWind.xml"])
    with pytest.raises(dl.ExportCheckError) as err:
        dl.check_export(zp, make_settings(min_size_bytes=10**9), today=date(2026, 10, 30))
    msg = str(err.value)
    assert "29 days old" in msg
    assert "expected at least" in msg
    assert "EinheitenSolar_*.xml" in msg


def test_check_detects_corrupted_file(tmp_path):
    zp = make_export(tmp_path / "Gesamtdatenexport_20261030.zip")
    raw = bytearray(zp.read_bytes())
    # Flip bytes inside the first member's compressed data.
    with zipfile.ZipFile(zp) as zf:
        info = zf.infolist()[0]
    start = info.header_offset + 30 + len(info.filename) + 5
    raw[start : start + 8] = b"\x00" * 8
    zp.write_bytes(bytes(raw))
    with pytest.raises(dl.ExportCheckError, match="Integrity check failed"):
        dl.check_export(zp, make_settings(), today=date(2026, 10, 30))


def test_check_rejects_non_zip(tmp_path):
    zp = tmp_path / "Gesamtdatenexport_20261030.zip"
    zp.write_bytes(b"<html>error page</html>" * 10)
    with pytest.raises(dl.ExportCheckError, match="not a readable zip"):
        dl.check_export(zp, make_settings(), today=date(2026, 10, 30))


def test_meta_file(tmp_path):
    zp = make_export(tmp_path / "Gesamtdatenexport_20261030.zip")
    check = dl.check_export(zp, make_settings(), today=date(2026, 10, 30))
    meta = dl.write_meta(tmp_path / "download_meta.json", zp, source_url="http://x", check=check)
    assert meta["sha256"] == dl.sha256_of(zp)
    assert (tmp_path / "download_meta.json").exists()
