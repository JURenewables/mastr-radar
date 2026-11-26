"""Infrastructure layers (contract v1.13, WP104).

Station 1 (`infra-fetch`, cached in data/infra/):
- power grid ≥ 220 kV: PyPSA-Eur prebuilt network from OpenStreetMap
  (Zenodo 23896564, ODbL 1.0);
- gas transmission pipelines: SciGRID_gas IGGIELGNC-3 (Zenodo 5079748,
  CC BY 4.0);
- hydrogen core network: Bundesnetzagentur approval annexes (pipeline
  segments with start and end place, hydrogen projects by district;
  Datenlizenz Deutschland – Namensnennung).

Station 3 (`infra-build`) → hubs/infrastructure.json. Hydrogen segments are
drawn as straight lines between their geocoded start and end places
(schematic); places are geocoded with municipality locations from the
register.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import zipfile
from pathlib import Path

import openpyxl
import pandas as pd
import pyarrow.parquet as pq
import requests

FILE = "hubs/infrastructure.json"
SOURCES = {
    "power_lines": "https://zenodo.org/api/records/23896564/files/lines.csv/content",
    "power_buses": "https://zenodo.org/api/records/23896564/files/buses.csv/content",
    "gas": "https://zenodo.org/api/records/5079748/files/IGGIELGNC.zip/content",
    "h2_projects": "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Wasserstoff/_DL/Antrag_FNB_Anlage1.xlsx?__blob=publicationFile",
    "h2_reported": "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Wasserstoff/_DL/geaendert_Anlage2.xlsx?__blob=publicationFile",
    "h2_new": "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Wasserstoff/_DL/geaendert_Anlage3.xlsx?__blob=publicationFile",
    "h2_conversion": "https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Wasserstoff/_DL/geaendert_Anlage4.xlsx?__blob=publicationFile",
}
FILENAMES = {
    "power_lines": "osm_lines.csv",
    "power_buses": "osm_buses.csv",
    "gas": "scigrid_gas.zip",
    "h2_projects": "h2_anlage1.xlsx",
    "h2_reported": "h2_anlage2.xlsx",
    "h2_new": "h2_anlage3.xlsx",
    "h2_conversion": "h2_anlage4.xlsx",
}
ATTRIBUTION = {
    "power": (
        "© OpenStreetMap contributors (ODbL 1.0), via PyPSA-Eur prebuilt network (Zenodo 23896564)"
    ),
    "gas": "SciGRID_gas IGGIELGNC-3, DLR (CC BY 4.0), Zenodo 5079748",
    "hydrogen": (
        "Bundesnetzagentur, Wasserstoff-Kernnetz approval annexes "
        "(Datenlizenz Deutschland – Namensnennung); schematic by MaStR Radar"
    ),
}


class InfraCheckError(Exception):
    """Raised when the infrastructure layers break the contract."""


def fetch(cache: Path) -> list[Path]:
    cache.mkdir(parents=True, exist_ok=True)
    out = []
    for key, url in SOURCES.items():
        path = cache / FILENAMES[key]
        r = requests.get(url, timeout=300, headers={"User-Agent": "mastr-radar"})
        r.raise_for_status()
        path.write_bytes(r.content)
        out.append(path)
    return out


# ---------- geometry helpers ----------


def _germany(boundaries: Path):
    """Polygons of Germany (list of rings) from the states boundaries."""
    g = json.loads((boundaries / "states.geojson").read_text())
    rings = []
    for f in g["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            rings.append(poly[0])
    return rings


def _inside(lon: float, lat: float, rings) -> bool:
    if not (5.8 <= lon <= 15.1 and 47.2 <= lat <= 55.1):
        return False
    for ring in rings:
        c = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi:
                c = not c
            j = i
        if c:
            return True
    return False


def _simplify(coords: list[list[float]], tol: float = 0.01) -> list[list[float]]:
    """Drop points closer than `tol` degrees to the last kept point; round to 3 decimals."""
    if len(coords) <= 2:
        return [[round(x, 3), round(y, 3)] for x, y in coords]
    out = [coords[0]]
    for p in coords[1:-1]:
        if abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1]) >= tol:
            out.append(p)
    out.append(coords[-1])
    return [[round(x, 3), round(y, 3)] for x, y in out]


def _wkt_line(s: str) -> list[list[float]]:
    s = s.strip("'\" ")
    if "(" not in s or ")" not in s:
        return []
    inner = s[s.index("(") + 1 : s.rindex(")")].replace("(", "").replace(")", "")
    pts = []
    for part in inner.split(","):
        xy = part.split()
        if len(xy) >= 2:
            pts.append([float(xy[0]), float(xy[1])])
    return pts


# ---------- layers ----------


def power(cache: Path) -> dict:
    csv.field_size_limit(sys.maxsize)
    buses = {}
    with open(cache / FILENAMES["power_buses"], newline="") as fh:
        for r in csv.DictReader(fh):
            if r.get("country") == "DE":
                buses[r["bus_id"]] = (
                    float(r["x"]),
                    float(r["y"]),
                    int(float(r["voltage"])),
                    r["under_construction"] == "t",
                )
    lines = []
    with open(cache / FILENAMES["power_lines"], newline="") as fh:
        for r in csv.DictReader(fh, restkey="_rest"):
            # geometry is single-quoted WKT with commas: rejoin the split fields
            r["geometry"] = ",".join([r["geometry"] or "", *r.get("_rest", [])])
            if r["bus0"] not in buses and r["bus1"] not in buses:
                continue
            v = int(float(r["voltage"]))
            if v < 220:
                continue
            raw = _wkt_line(r["geometry"])
            if len(raw) < 2:
                continue
            pts = _simplify(raw)
            lines.append([v, 1 if r["under_construction"] == "t" else 0, pts])
    subs = [
        [round(x, 3), round(y, 3), v, 1 if uc else 0] for x, y, v, uc in buses.values() if v >= 220
    ]
    return {"lines": lines, "substations": subs}


def gas(cache: Path, rings) -> list:
    with zipfile.ZipFile(cache / FILENAMES["gas"]) as z:
        name = next(n for n in z.namelist() if n.endswith("PipeSegments.geojson"))
        g = json.loads(z.read(name))
    out = []
    for f in g["features"]:
        coords = f["geometry"]["coordinates"]
        if not any(_inside(x, y, rings) for x, y in coords):
            continue
        p = f["properties"].get("param")
        p = p if isinstance(p, dict) else eval_dict(p)
        out.append([p.get("diameter_mm"), _simplify(coords)])
    return out


def eval_dict(s) -> dict:
    """SciGRID stores 'param' as a Python dict literal."""
    import ast

    try:
        return ast.literal_eval(s) if isinstance(s, str) else {}
    except (ValueError, SyntaxError):
        return {}


def gazetteer(extract_dir: Path) -> dict[str, tuple[float, float]]:
    u = (
        pq.read_table(extract_dir / "units.parquet", columns=["municipality", "lat", "lon"])
        .to_pandas()
        .dropna()
    )
    g = u.groupby(u.municipality.str.lower()).agg(lat=("lat", "median"), lon=("lon", "median"))
    return {k: (float(r.lon), float(r.lat)) for k, r in g.iterrows()}


GEOCODE_CACHE = "geocode.json"


def substation_place(asset: str) -> str:
    """'UW Dörpen-West' → 'Dörpen': strip the substation prefix and direction suffix."""
    s = re.sub(r"^(UW|Umspannwerk|SWA|KUW|USW)\s+", "", asset.strip())
    s = re.sub(r"[-\s](West|Ost|Nord|Süd|Sued|Mitte|\d+)$", "", s)
    return s.strip()


def geocode_missing(cache: Path, extract_dir: Path) -> int:
    """Station 1: geocode hydrogen segment places our gazetteer cannot match, with
    OpenStreetMap Nominatim (1 request/s, cached; ODbL)."""
    import time

    gaz = gazetteer(extract_dir)
    path = cache / GEOCODE_CACHE
    known = json.loads(path.read_text()) if path.exists() else {}
    places = set()
    for key in ("h2_reported", "h2_new", "h2_conversion"):
        h, rows = _sheet(cache / FILENAMES[key])
        ia = next(i for i, x in enumerate(h) if x.startswith("Anfangspunkt"))
        ie = next(i for i, x in enumerate(h) if x.startswith("Endpunkt"))
        for r in rows:
            if r and r[0] and re.match(r"^[A-Z]{3}\d", str(r[0])):
                places.update(str(x).strip() for x in (r[ia], r[ie]) if x)
    rd = extract_dir.parent.parent / "web" / "public" / "data" / "grid" / "redispatch.json"
    if rd.exists():
        for x in json.loads(rd.read_text())["last_12m"].get("renewable_substations", []):
            places.add(substation_place(x["asset"]))
    n = 0
    for pl in sorted(places):
        if pl in known or geocode(pl, gaz, {}) is not None:
            continue
        q = re.sub(r"\s*\((.*)\)", r" \1", pl)
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "countrycodes": "de", "format": "json", "limit": 1},
            headers={
                "User-Agent": "mastr-radar open-data project (github.com/JURenewables/mastr-radar)"
            },
            timeout=30,
        )
        hit = r.json() if r.ok else []
        known[pl] = [float(hit[0]["lon"]), float(hit[0]["lat"])] if hit else None
        n += 1
        time.sleep(1.1)
    path.write_text(json.dumps(known, ensure_ascii=False, indent=0))
    return n


def geocode(
    place, gaz: dict[str, tuple[float, float]], extra: dict | None = None
) -> tuple[float, float] | None:
    if place is None:
        return None
    s = str(place).strip()
    if extra and extra.get(s):
        return tuple(extra[s])
    m = re.search(r"\(([^)]+)\)", s)
    cands = [
        s,
        re.sub(r"\s*\(.*\)", "", s),
        m.group(1) if m else None,
        re.sub(r"^(OT|GDRM|Station|UGS|VS|VDS|GÜS|KW|GDRA|ÜS|Kraftwerk)\s+", "", s),
        s.split("-")[0],
        s.split("/")[0],
        s.split(" ")[0],
    ]
    keys = list(gaz)
    for c in cands:
        if not c:
            continue
        k = c.lower().strip()
        if k in gaz:
            return gaz[k]
        pref = [x for x in keys if x.startswith(k + " ") or x.startswith(k + ",")]
        if len(pref) >= 1 and len(k) >= 4:
            return gaz[sorted(pref, key=len)[0]]
    return None


def _sheet(path: Path) -> tuple[list[str], list[tuple]]:
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hi = next(
        i for i, r in enumerate(rows) if r and r[0] and str(r[0]).startswith(("Antrags-ID", "ID"))
    )
    return [str(x) for x in rows[hi]], rows[hi + 1 :]


def hydrogen(cache: Path, gaz, district_centroids: dict[str, tuple[float, float]]) -> dict:
    segs, unmatched = [], 0
    gpath = cache / GEOCODE_CACHE
    extra = json.loads(gpath.read_text()) if gpath.exists() else {}
    for key, kind in (
        ("h2_reported", "reported"),
        ("h2_new", "new_build"),
        ("h2_conversion", "conversion"),
    ):
        h, rows = _sheet(cache / FILENAMES[key])

        def col(prefix: str, h=h) -> int:
            return next(i for i, x in enumerate(h) if x.startswith(prefix))

        ia, ie, idn, il = col("Anfangspunkt"), col("Endpunkt"), col("Nenndurchmesser"), col("Länge")
        iy = next(
            (i for i, x in enumerate(h) if x.startswith(("Planerische", "Umstellungsdatum"))), None
        )
        ib = next((i for i, x in enumerate(h) if x.startswith("Bestand/Umstellung")), None)
        for r in rows:
            if not r or not r[0] or not re.match(r"^[A-Z]{3}\d", str(r[0])):
                continue
            a, b = geocode(r[ia], gaz, extra), geocode(r[ie], gaz, extra)
            km = r[il] if isinstance(r[il], (int, float)) else None
            if a and b and km is not None:
                straight = ((a[0] - b[0]) * 69.0) ** 2 + ((a[1] - b[1]) * 111.2) ** 2
                if straight**0.5 > 2.0 * km + 10:  # geocode does not fit the stated length
                    a = b = None
            if a is None or b is None:
                unmatched += 1
            year = str(r[iy]) if iy is not None and r[iy] is not None else None
            k = kind
            if kind == "reported" and ib is not None and r[ib]:
                k = {"Bestand": "existing", "Umstellung": "conversion", "Neubau": "new_build"}.get(
                    str(r[ib]).strip(), "reported"
                )
            segs.append(
                {
                    "id": str(r[0]),
                    "kind": k,
                    "from": str(r[ia]),
                    "to": str(r[ie]),
                    "dn": r[idn],
                    "km": r[il],
                    "year": year,
                    "coords": [[round(a[0], 3), round(a[1], 3)], [round(b[0], 3), round(b[1], 3)]]
                    if a and b
                    else None,
                }
            )
    h, rows = _sheet(cache / FILENAMES["h2_projects"])
    projects: dict[str, dict] = {}
    purpose_cols = [
        (i, x.split("\n")[0].replace("Dekarbonisierung der Industrie:", "").strip())
        for i, x in enumerate(h)
        if "[x" in x or "Dekarbonisierung" in x
    ]
    for r in rows:
        if not r or not r[0]:
            continue
        pid = str(r[0])
        p = projects.setdefault(
            pid,
            {
                "id": pid,
                "name": r[1],
                "state": r[3],
                "district": r[4],
                "feed_in_mw": None,
                "take_off_mw": None,
                "electrolysis_mw": None,
                "purposes": [],
            },
        )
        metric, val = str(r[5] or ""), r[7]
        num = float(val) if isinstance(val, (int, float)) else None
        if metric.startswith("Wasserstoff Einspeiseleistung"):
            p["feed_in_mw"] = num
        elif metric.startswith("Wasserstoff Ausspeiseleistung"):
            p["take_off_mw"] = num
        elif metric.startswith("Elektrolyseleistung"):
            p["electrolysis_mw"] = num
        for i, name in purpose_cols:
            if i < len(r) and str(r[i] or "").strip().lower() == "x" and name not in p["purposes"]:
                p["purposes"].append(name)
    for p in projects.values():
        d = re.sub(r"^(LK|SK|Region|Stadt)\s+", "", str(p["district"] or "")).strip().lower()
        c = district_centroids.get(d) or next(
            (v for k, v in district_centroids.items() if k.startswith(d) or d.startswith(k)), None
        )
        p["lon"], p["lat"] = (round(c[0], 3), round(c[1], 3)) if c else (None, None)
    return {"segments": segs, "unmatched_segments": unmatched, "projects": list(projects.values())}


def district_centroids(boundaries: Path) -> dict[str, tuple[float, float]]:
    g = json.loads((boundaries / "districts.geojson").read_text())
    out = {}
    for f in g["features"]:
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        pts = [p for poly in polys for p in poly[0]]
        out[str(f["properties"]["name"]).lower()] = (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )
    return out


def build(cache: Path, extract_dir: Path, out_dir: Path) -> list[dict]:
    boundaries = out_dir / "boundaries"
    rings = _germany(boundaries)
    out = {
        "attribution": ATTRIBUTION,
        "power": power(cache),
        "gas": gas(cache, rings),
        "hydrogen": hydrogen(cache, gazetteer(extract_dir), district_centroids(boundaries)),
    }
    _validate(out)
    path = out_dir / FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    n = len(out["power"]["lines"]) + len(out["gas"]) + len(out["hydrogen"]["segments"])
    return [{"name": FILE, "rows": n, "bytes": path.stat().st_size}]


def check(out_dir: Path) -> None:
    _validate(json.loads((out_dir / FILE).read_text()))


def _validate(d: dict) -> None:
    problems = []
    if len(d["power"]["lines"]) < 300:
        problems.append(f"only {len(d['power']['lines'])} power lines.")
    if len(d["power"]["substations"]) < 100:
        problems.append("too few substations.")
    if len(d["gas"]) < 100:
        problems.append(f"only {len(d['gas'])} gas segments.")
    h = d["hydrogen"]
    if len(h["segments"]) < 200 or len(h["projects"]) < 100:
        problems.append("too few hydrogen segments or projects.")
    placed = sum(s["coords"] is not None for s in h["segments"])
    if placed < 0.5 * len(h["segments"]):
        problems.append(f"only {placed} of {len(h['segments'])} hydrogen segments placed.")
    for x in d["power"]["substations"]:
        if not (5.5 < x[0] < 15.5 and 47 < x[1] < 55.5):
            problems.append("substation outside Germany.")
            break
    if problems:
        raise InfraCheckError("Infrastructure check failed: " + " ".join(problems))


__all__ = ["build", "check", "fetch", "pd"]
