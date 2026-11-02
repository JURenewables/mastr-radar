import json
from datetime import date

from mastr_radar import gridapis, gridextract, redispatch

HEADER = (
    "BEGINN_DATUM;BEGINN_UHRZEIT;ZEITZONE_VON;ENDE_DATUM;ENDE_UHRZEIT;ZEITZONE_BIS;"
    "GRUND_DER_MASSNAHME;RICHTUNG;MITTLERE_LEISTUNG_MW;MAXIMALE_LEISTUNG_MW;GESAMTE_ARBEIT_MWH;"
    "ANWEISENDER_UENB;ANFORDERNDER_UENB;BETROFFENE_ANLAGE;PRIMAERENERGIEART"
)


def _cache(tmp_path):
    nt = tmp_path / "nt"
    nt.mkdir()
    for m in range(1, 14):
        y, mm = (2025, m) if m <= 12 else (2026, 1)
        rows = [HEADER]
        for i in range(90):
            down = i % 2 == 0
            day, hour = (i % 27) + 1, i % 24
            reason = (
                "Strombedingter Countertrade DE-DK1" if i % 15 == 0 else "Strombedingter Redispatch"
            )
            direction = "Wirkleistungseinspeisung " + ("reduzieren" if down else "erhöhen")
            asset = "UW Büttel;Erneuerbar" if down else "Emsland Block C;Konventionell"
            when = f"{day:02d}.{mm:02d}.{y}"
            rows.append(
                f"{when};{hour:02d}:00;UTC;{when};{hour:02d}:30;UTC;{reason};{direction};"
                f"100;120;1.200;TenneT DE;TenneT DE;{asset}"
            )
        (nt / f"redispatch_{y}-{mm:02d}.csv").write_text("\n".join(rows), encoding="utf-8")
    ent = tmp_path / "entsoe"
    ent.mkdir()
    for code in gridapis.NEIGHBOURS:
        pts = [(f"2026-01-01T{h:02d}:00:00+00:00", 500.0) for h in range(24)]
        (ent / f"flows_{code}_2026-01.json").write_text(
            json.dumps({"import": pts, "export": [(t, 200.0) for t, _ in pts]})
        )
    return nt, ent


def test_extract_and_build(tmp_path):
    nt, ent = _cache(tmp_path)
    ex = tmp_path / "extract"
    n = gridextract.extract_redispatch(nt, ex / "redispatch.parquet")
    assert n > 1000
    assert gridextract.extract_flows(ent, ex / "flows.parquet") == 24 * len(gridapis.NEIGHBOURS)
    gridextract.check(ex / "redispatch.parquet", ex / "flows.parquet")
    out = tmp_path / "web"
    files = redispatch.build(ex, out, date(2026, 2, 1))
    assert {f["name"] for f in files} == {redispatch.REDISPATCH_FILE, redispatch.FLOWS_FILE}
    rd = json.loads((out / redispatch.REDISPATCH_FILE).read_text())
    assert rd["monthly"][0]["down_mwh"]["renewable"] > 0  # "1.200" parsed as 1200
    assert rd["last_12m"]["renewable_substations"][0]["asset"] == "UW Büttel"
    fl = json.loads((out / redispatch.FLOWS_FILE).read_text())
    assert fl["last_12m"]["FR"]["import_gwh"] == 12  # 24 h × 500 MW
    redispatch.check(out)


def test_parse_series():
    xml = """<Publication_MarketDocument xmlns="urn:x"><TimeSeries><Period>
    <timeInterval><start>2026-01-01T00:00Z</start><end>2026-01-01T01:00Z</end></timeInterval>
    <resolution>PT15M</resolution><Point><position>1</position><quantity>10</quantity></Point>
    <Point><position>3</position><quantity>30</quantity></Point></Period></TimeSeries></Publication_MarketDocument>"""
    pts = gridapis.parse_series(xml)
    assert pts == [("2026-01-01T00:00:00+00:00", 10.0), ("2026-01-01T00:30:00+00:00", 30.0)]
