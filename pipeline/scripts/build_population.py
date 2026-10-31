"""One-off: population per state and district from BKG VG250-EW (GeoPackage).

Rerun once a year when BKG publishes a new VG250-EW:

    BASE=https://daten.gdz.bkg.bund.de/produkte/vg/vg250-ew_ebenen_1231/aktuell
    curl -O $BASE/vg250-ew_12-31.utm32s.gpkg.ebenen.zip
    unzip vg250-ew_12-31.utm32s.gpkg.ebenen.zip -d vg250-ew
    python scripts/build_population.py \
        vg250-ew/vg250-ew_ebenen_1231/DE_VG250.gpkg assets/population.json

Source: © GeoBasis-DE / BKG (2026), dl-de/by-2-0; population figures from the
Statistische Ämter des Bundes und der Länder, contained in VG250-EW.
"""

import json
import sqlite3
import sys


def read(conn: sqlite3.Connection, table: str) -> dict[str, int]:
    rows = conn.execute(f"select AGS, EWZ from {table} where GF = 4").fetchall()
    return {key: int(ewz) for key, ewz in rows}


def main(gpkg: str, out: str) -> None:
    conn = sqlite3.connect(gpkg)
    states, districts = read(conn, "vg250_lan"), read(conn, "vg250_krs")
    data = {
        "reference": "BKG VG250-EW, boundaries as of 31 Dec 2025",
        "attribution": (
            "© GeoBasis-DE / BKG (2026), dl-de/by-2-0; Statistische Ämter des Bundes und der Länder"
        ),
        "total": sum(states.values()),
        "states": dict(sorted(states.items())),
        "districts": dict(sorted(districts.items())),
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{out}: {len(states)} states, {len(districts)} districts, total {data['total']:,}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
