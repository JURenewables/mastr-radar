"""Grid data from Netztransparenz (TSO redispatch) and ENTSO-E (cross-border
flows): station 1 downloads into data/grid/ (contract v1.8 draft).

Credentials come only from the environment (GitHub Secrets in the daily run):
NETZTRANSPARENZ_CLIENT_ID, NETZTRANSPARENZ_CLIENT_SECRET, ENTSOE_TOKEN.
They are never logged, written to disk or put in URLs that are printed.
"""

from __future__ import annotations

import io
import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pandas as pd
import requests

NT_TOKEN_URL = "https://identity.netztransparenz.de/users/connect/token"
NT_BASE = "https://ds.netztransparenz.de/api/v1"
NT_FIRST_MONTH = date(2021, 1, 1)
ENTSOE_BASE = "https://web-api.tp.entsoe.eu/api"
DE_LU = "10Y1001A1001A82H"
# Neighbouring bidding zones of DE-LU (physical flows, documentType A11).
NEIGHBOURS = {
    "AT": "10YAT-APG------L",
    "BE": "10YBE----------2",
    "CH": "10YCH-SWISSGRIDZ",
    "CZ": "10YCZ-CEPS-----N",
    "DK1": "10YDK-1--------W",
    "DK2": "10YDK-2--------M",
    "FR": "10YFR-RTE------C",
    "NL": "10YNL----------L",
    "NO2": "10YNO-2--------T",
    "PL": "10YPL-AREA-----S",
    "SE4": "10Y1001A1001A47J",
}
REFETCH_MONTHS = 2  # recent months are corrected later, so fetch them again


class ApiError(Exception):
    """A grid API could not be reached or answered with an error."""


def _secret(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ApiError(f"{name} is not set (add it as a GitHub Secret).")
    return value


def _request(method: str, url: str, tries: int = 4, **kw) -> requests.Response:
    for i in range(tries):
        try:
            r = requests.request(method, url, timeout=120, **kw)
            if r.status_code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 ** (i + 2))
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as exc:
            if i == tries - 1:
                # Never include the URL: ENTSO-E carries the token in the query string.
                status = getattr(exc.response, "status_code", "")
                raise ApiError(f"{method} request failed: {type(exc).__name__} {status}") from None
            time.sleep(2 ** (i + 2))
    raise AssertionError("unreachable")


def _months(first: date, today: date) -> list[date]:
    out, m = [], first.replace(day=1)
    while m <= today:
        out.append(m)
        m = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


def _month_end(m: date) -> date:
    return (m.replace(day=28) + timedelta(days=4)).replace(day=1)


# --- Netztransparenz ----------------------------------------------------------


def nt_token() -> str:
    r = _request(
        "POST",
        NT_TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": _secret("NETZTRANSPARENZ_CLIENT_ID"),
            "client_secret": _secret("NETZTRANSPARENZ_CLIENT_SECRET"),
        },
    )
    return r.json()["access_token"]


def nt_csv(token: str, path: str) -> str:
    r = _request("GET", f"{NT_BASE}/{path}", headers={"Authorization": f"Bearer {token}"})
    r.encoding = r.encoding or "utf-8"
    return r.text.lstrip("﻿")


def fetch_redispatch(cache_dir: Path, today: date, first: date = NT_FIRST_MONTH) -> int:
    """TSO redispatch measures, one CSV per month (2021 onwards)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    token = nt_token()
    recent = _months(first, today)[-REFETCH_MONTHS:]
    n = 0
    for m in _months(first, today):
        path = cache_dir / f"redispatch_{m:%Y-%m}.csv"
        if path.exists() and m not in recent:
            continue
        a = datetime(m.year, m.month, 1, tzinfo=UTC)
        b = datetime.combine(
            min(_month_end(m), today + timedelta(days=1)), datetime.min.time(), UTC
        )
        text = nt_csv(token, f"data/redispatch/{a:%Y-%m-%dT%H:%M:%S}/{b:%Y-%m-%dT%H:%M:%S}")
        path.write_text(text, encoding="utf-8")
        n += 1
    return n


def read_redispatch(cache_dir: Path) -> pd.DataFrame:
    frames = [
        pd.read_csv(
            io.StringIO(p.read_text("utf-8")), sep=";", decimal=",", na_values=["N.A."], dtype=str
        )
        for p in sorted(cache_dir.glob("redispatch_*.csv"))
        if p.stat().st_size > 0
    ]
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


# --- ENTSO-E ------------------------------------------------------------------


def entsoe_xml(params: dict) -> str | None:
    """One ENTSO-E query; None when the platform has no data for it."""
    r = requests.get(
        ENTSOE_BASE, params={**params, "securityToken": _secret("ENTSOE_TOKEN")}, timeout=120
    )
    if r.status_code == 200:
        return r.text
    if "No matching data found" in r.text or r.status_code == 400 and "Acknowledgement" in r.text:
        return None
    if r.status_code in (429, 500, 502, 503):
        time.sleep(10)
        return entsoe_xml(params)
    raise ApiError(f"ENTSO-E answered {r.status_code}")


def parse_series(xml: str) -> list[tuple[str, float]]:
    """(UTC start ISO, MW) points from a Publication_MarketDocument, any resolution."""
    root = ET.fromstring(xml)
    ns = {"n": root.tag.split("}")[0].strip("{")}
    out = []
    for period in root.iterfind(".//n:Period", ns):
        start = datetime.fromisoformat(
            period.find("n:timeInterval/n:start", ns).text.replace("Z", "+00:00")
        )
        res = period.find("n:resolution", ns).text
        step = {"PT15M": 15, "PT30M": 30, "PT60M": 60}.get(res, 60)
        for pt in period.iterfind("n:Point", ns):
            pos = int(pt.find("n:position", ns).text)
            out.append(
                (
                    (start + timedelta(minutes=step * (pos - 1))).isoformat(),
                    float(pt.find("n:quantity", ns).text),
                )
            )
    return out


def fetch_flows(cache_dir: Path, today: date, days: int = 400) -> int:
    """Physical flows DE-LU ↔ each neighbour, one JSON per month and neighbour."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    first = (today - timedelta(days=days)).replace(day=1)
    recent = _months(first, today)[-REFETCH_MONTHS:]
    n = 0
    for m in _months(first, today):
        a = datetime(m.year, m.month, 1, tzinfo=UTC)
        b = datetime.combine(min(_month_end(m), today), datetime.min.time(), UTC)
        for code, eic in NEIGHBOURS.items():
            path = cache_dir / f"flows_{code}_{m:%Y-%m}.json"
            if path.exists() and m not in recent:
                continue
            out = {}
            for key, (src, dst) in {"import": (eic, DE_LU), "export": (DE_LU, eic)}.items():
                xml = entsoe_xml(
                    {
                        "documentType": "A11",
                        "in_Domain": dst,
                        "out_Domain": src,
                        "periodStart": f"{a:%Y%m%d%H%M}",
                        "periodEnd": f"{b:%Y%m%d%H%M}",
                    }
                )
                out[key] = parse_series(xml) if xml else []
            path.write_text(json.dumps(out), encoding="utf-8")
            n += 1
    return n


# --- Probe: summaries only, for checking access ------------------------------


def probe(today: date) -> list[str]:
    """Fetch one small window from each API and describe it without secrets."""
    lines = []
    try:
        token = nt_token()
        lines.append("Netztransparenz: token OK")
        a = datetime.combine(today - timedelta(days=14), datetime.min.time(), UTC)
        b = datetime.combine(today, datetime.min.time(), UTC)
        text = nt_csv(token, f"data/redispatch/{a:%Y-%m-%dT%H:%M:%S}/{b:%Y-%m-%dT%H:%M:%S}")
        df = pd.read_csv(io.StringIO(text), sep=";", decimal=",", dtype=str)
        lines.append(f"redispatch last 14 days: {len(df)} rows; columns: {list(df.columns)}")
        for col in (
            "GRUND_DER_MASSNAHME",
            "RICHTUNG",
            "ANWEISENDER_UENB",
            "ANFORDERNDER_UENB",
            "PRIMAERENERGIEART",
            "BETROFFENE_ANLAGE",
        ):
            if col in df:
                top = df[col].value_counts().head(12)
                lines.append(f"  {col}: " + "; ".join(f"{k} ({v})" for k, v in top.items()))
        if len(df):
            lines.append("  sample row: " + json.dumps(df.iloc[0].to_dict(), ensure_ascii=False))
    except ApiError as exc:
        lines.append(f"Netztransparenz: {exc}")
    try:
        a = datetime.combine(today - timedelta(days=3), datetime.min.time(), UTC)
        b = datetime.combine(today - timedelta(days=1), datetime.min.time(), UTC)
        for code in ("FR", "PL"):
            xml = entsoe_xml(
                {
                    "documentType": "A11",
                    "in_Domain": DE_LU,
                    "out_Domain": NEIGHBOURS[code],
                    "periodStart": f"{a:%Y%m%d%H%M}",
                    "periodEnd": f"{b:%Y%m%d%H%M}",
                }
            )
            pts = parse_series(xml) if xml else []
            mean = sum(v for _, v in pts) / max(len(pts), 1)
            lines.append(f"ENTSO-E flows {code}→DE: {len(pts)} points, mean {mean:.0f} MW")
    except ApiError as exc:
        lines.append(f"ENTSO-E: {exc}")
    return lines
