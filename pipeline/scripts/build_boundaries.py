"""One-off: turn BKG VG2500 shapefiles into small web GeoJSON files.

Boundaries change about once a year, so station 3 copies the stored result from
pipeline/assets/boundaries/ instead of downloading every day. Rerun when BKG
publishes a new year:

    curl -O https://daten.gdz.bkg.bund.de/produkte/vg/vg2500/aktuell/vg2500_01-01-2026.utm32s.shape.zip
    unzip vg2500_01-01-2026.utm32s.shape.zip -d vg2500
    uv run --no-project --with pyshp --with pyproj --with shapely \\
        python scripts/build_boundaries.py vg2500/vg2500 assets/boundaries

Source: © GeoBasis-DE / BKG (2026), dl-de/by-2-0. Layers LAN (states) and KRS
(districts), land areas only (GF = 9). Coordinates: UTM32N → WGS84, simplified.
"""

import json
import sys
from pathlib import Path

import numpy as np
import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

TOLERANCE_DEG = 0.004  # about 300–400 m; fine for national and state maps
DECIMALS = 4

_utm_to_wgs84 = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)


def to_wgs84(xy: np.ndarray) -> np.ndarray:
    return np.column_stack(_utm_to_wgs84.transform(xy[:, 0], xy[:, 1]))


def _round(coords):
    if isinstance(coords[0], (int, float)):
        return [round(c, DECIMALS) for c in coords]
    return [_round(c) for c in coords]


def convert(shp: Path, key_len: int) -> dict:
    reader = shapefile.Reader(str(shp))
    parts: dict[str, dict] = {}
    for sr in reader.iterShapeRecords():
        rec = sr.record.as_dict()
        if rec["GF"] != 9:  # land areas only
            continue
        key = rec["AGS"][:key_len]
        geom = shapely.transform(shape(sr.shape.__geo_interface__), to_wgs84)
        entry = parts.setdefault(key, {"name": rec["GEN"], "type": rec["BEZ"], "geoms": []})
        entry["geoms"].append(geom)
    features = []
    for key in sorted(parts):
        p = parts[key]
        geom = unary_union(p["geoms"]).simplify(TOLERANCE_DEG, preserve_topology=True)
        g = mapping(geom)
        features.append(
            {
                "type": "Feature",
                "properties": {"key": key, "name": p["name"], "type": p["type"]},
                "geometry": {"type": g["type"], "coordinates": _round(g["coordinates"])},
            }
        )
    return {
        "type": "FeatureCollection",
        "attribution": "© GeoBasis-DE / BKG (2026), dl-de/by-2-0",
        "features": features,
    }


def main(src: str, out: str) -> None:
    src_dir, out_dir = Path(src), Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for layer, name, key_len in [("LAN", "states", 2), ("KRS", "districts", 5)]:
        fc = convert(src_dir / f"VG2500_{layer}.shp", key_len)
        path = out_dir / f"{name}.geojson"
        path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
        print(f"{path}: {len(fc['features'])} features, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main(*sys.argv[1:3])
